import { Request, Response, NextFunction, Express } from 'express';
import createHttpError from 'http-errors';
import storageService from '../services/storage-supabase.js';
import { UploadContext } from '../types/upload/index.js';
import { AppDataSource } from '../config/database.js';
import { User } from '../models/user.js';
import { Concert } from '../models/concert.js';
import { ConcertSession } from '../models/concert-session.js';

// 合法的上傳上下文值
const ALLOWED_UPLOAD_CONTEXTS: UploadContext[] = [
  'USER_AVATAR',
  'VENUE_PHOTO',
  'CONCERT_SEATING_TABLE',
  'CONCERT_BANNER',
];

// 輔助函數：從 URL 解析 Storage 路徑
function getStoragePathFromUrl(url: string): string | null {
  try {
    const urlParts = url.split('/public/');
    if (urlParts.length === 2) {
      return urlParts[1];
    }
  } catch (e) { console.log(e); /* 忽略解析錯誤 */ }
  return null;
}

// 輔助函數：刪除舊圖片 (帶錯誤處理)
async function deleteOldImage(oldUrls: string | string[] | null | undefined): Promise<void> {
  if (!oldUrls) return;

  // 統一轉換為陣列處理
  const urlsToDelete = Array.isArray(oldUrls) ? oldUrls : [oldUrls];

  for (const oldUrl of urlsToDelete) {
    if (!oldUrl) continue;
    const oldStoragePath = getStoragePathFromUrl(oldUrl);
    if (oldStoragePath) {
      try {
        await storageService.deleteImage(oldStoragePath);
        console.log(`舊圖片已刪除: ${oldStoragePath}`);
      } catch (deleteError) {
        console.error(`刪除舊圖片失敗 (${oldStoragePath}):`, deleteError);
      }
    } else {
      console.warn(`無法從舊圖片 URL 解析路徑: ${oldUrl}`);
    }
  }
}

/**
 * 上傳圖片
 * 接收並處理通過 multipart/form-data 上傳的圖片檔案
 * 支援兩種模式：
 * 1. 臨時上傳模式：不提供 targetId，只上傳圖片並返回 URL
 * 2. 直接關聯模式：提供 targetId，上傳圖片並與目標實體關聯
 */
async function uploadImage(req: Request, res: Response, next: NextFunction) {
  try {
    // 1. 從請求中獲取檔案和相關參數
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const singleFile = files?.file?.[0];
    
    const { uploadContext } = req.body;
    let targetIdFromBody = req.body.targetId; // 可能為空，表示暫存上傳模式
    const userIdFromToken = (req.user as any)?.userId;
    const userRoleFromToken = (req.user as any)?.role; // 取得 user role
    // 自動判斷 isTemp：沒帶 targetId 就是暫存
    const isTempUpload = !targetIdFromBody;
    
    // 2. 驗證請求參數
    // 2.1 驗證是否有檔案（統一使用單檔案模式）
    if (!singleFile) {
      return next(createHttpError(400, '缺少圖片檔案'));
    }
    
    // 2.2 驗證檔案類型
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimeTypes.includes(singleFile.mimetype)) {
      return next(createHttpError(400, `不支援的檔案類型 (${singleFile.originalname})，僅接受 JPEG, PNG, GIF 或 WebP 格式`));
    }
    
    // 2.3 驗證是否有 uploadContext
    if (!uploadContext) {
      return next(createHttpError(400, '缺少必要的 \'uploadContext\' 欄位'));
    }
    
    // 2.4 驗證 uploadContext 是否為允許的值
    if (!ALLOWED_UPLOAD_CONTEXTS.includes(uploadContext as UploadContext)) {
      return next(createHttpError(400, `無效的 'uploadContext' 值: ${uploadContext}`));
    }
    
    // 2.5 根據 uploadContext 確定並驗證 targetId，並獲取相關實體
    let effectiveTargetId: string | number | undefined;
    let userToUpdate: User | null = null;
    let concertToUpdate: Concert | null = null;
    let sessionToUpdate: ConcertSession | null = null;
    let oldImageUrls: string | string[] | null | undefined = null; // 用於存儲待刪除的舊圖片 URL(s)
    
    // 沒帶 targetId 一律當作暫存上傳
    if (isTempUpload) {
      effectiveTargetId = undefined;
    } else if (uploadContext === 'USER_AVATAR') {
      if (!userIdFromToken) return next(createHttpError(401, '用戶未經驗證'));
      effectiveTargetId = userIdFromToken;
      const userRepository = AppDataSource.getRepository(User);
      userToUpdate = await userRepository.findOne({ where: { userId: String(effectiveTargetId) } });
      if (!userToUpdate) return next(createHttpError(404, '找不到用戶'));
      oldImageUrls = userToUpdate.avatar;
    } else if (uploadContext === 'VENUE_PHOTO') {
      if (userRoleFromToken !== 'admin') {
        return next(createHttpError(403, '僅限管理員上傳場館圖片'));
      }
      effectiveTargetId = targetIdFromBody;
    } else if (uploadContext === 'CONCERT_SEATING_TABLE') {
      effectiveTargetId = targetIdFromBody;
      const sessionRepository = AppDataSource.getRepository(ConcertSession);
      sessionToUpdate = await sessionRepository.findOne({ where: { sessionId: effectiveTargetId as string } });
      if (!sessionToUpdate) return next(createHttpError(404, '找不到音樂會場次'));
      oldImageUrls = sessionToUpdate.imgSeattable;
    } else if (uploadContext === 'CONCERT_BANNER') {
      effectiveTargetId = targetIdFromBody;
      const concertRepository = AppDataSource.getRepository(Concert);
      concertToUpdate = await concertRepository.findOne({ where: { concertId: effectiveTargetId as string } });
      if (!concertToUpdate) return next(createHttpError(404, '找不到音樂會'));
      oldImageUrls = concertToUpdate.imgBanner;
    } else {
      effectiveTargetId = targetIdFromBody;
    }
    
    // 3. 呼叫服務上傳圖片
    const uploadImagePayload: any = {
      fileBuffer: singleFile.buffer,
      originalName: singleFile.originalname,
      mimetype: singleFile.mimetype,
      uploadContext: uploadContext as UploadContext,
    };
    if (effectiveTargetId !== undefined) {
      uploadImagePayload.targetId = effectiveTargetId;
    }
    const uploadResult = await storageService.uploadImage(uploadImagePayload);
    
    // 4. 僅在有 targetId（非暫存）時更新資料庫欄位
    if (!isTempUpload) {
      try {
        if (userToUpdate) {
          userToUpdate.avatar = uploadResult.url;
          await AppDataSource.getRepository(User).save(userToUpdate);
        } else if (sessionToUpdate) {
          sessionToUpdate.imgSeattable = uploadResult.url;
          await AppDataSource.getRepository(ConcertSession).save(sessionToUpdate);
        } else if (concertToUpdate) {
          concertToUpdate.imgBanner = uploadResult.url;
          await AppDataSource.getRepository(Concert).save(concertToUpdate);
        }
      } catch (e) {
        console.error('更新資料庫失敗:', e);
        try {
          await storageService.deleteImage(uploadResult.path);
        } catch (deleteError) {
          console.error('Failed to delete image from storage after DB error:', deleteError);
        }
        return next(createHttpError(500, '更新資料庫失敗'));
      }
      deleteOldImage(oldImageUrls).catch(() => {});
    }
    
    // 5. 回傳成功回應
    res.status(200).json({
      status: 'success',
      message: isTempUpload ? '圖片暫存成功' : '圖片上傳成功',
      data: uploadResult.url
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 刪除圖片
 * 刪除特定 URL 的圖片
 */
async function deleteImage(req: Request, res: Response, next: NextFunction) {
  try {
    const { url, urls, uploadContext } = req.body;
    let targetIdFromBody = req.body.targetId; // 僅在非 USER_AVATAR 時需要
    const userIdFromToken = (req.user as any)?.userId;
    
    // 驗證
    if (!url && (!Array.isArray(urls) || urls.length === 0)) {
      return next(createHttpError(400, '缺少必要的 \'url\' 或 \'urls\' 欄位'));
    }
    if (!uploadContext) {
      return next(createHttpError(400, '缺少必要的 \'uploadContext\' 欄位'));
    }
    
    // 統一處理為 URL 陣列
    const urlsToDelete: string[] = url ? [url] : (urls as string[]);
    
    // 將 URL 轉換為 path
    const pathsToDelete: string[] = [];
    for (const urlToDelete of urlsToDelete) {
      const path = getStoragePathFromUrl(urlToDelete);
      if (!path) {
        return next(createHttpError(400, `無法從 URL 解析出檔案路徑: ${urlToDelete}`));
      }
      pathsToDelete.push(path);
    }
    
    // 確定目標 ID 和權限檢查
    let effectiveTargetId: string | number | undefined;
    if (uploadContext === 'USER_AVATAR') {
      if (!userIdFromToken) {
        return next(createHttpError(401, '用戶未經驗證'));
      }
      effectiveTargetId = userIdFromToken;
      // 不需要額外權限檢查，因為操作目標就是自己
    } else {
      // 其他 context 可能需要 targetId 進行權限檢查或記錄
      if (!targetIdFromBody && (uploadContext === 'CONCERT_SEATING_TABLE' || uploadContext === 'CONCERT_BANNER' || uploadContext === 'VENUE_PHOTO')) {
        // 對於這些需要 targetId 的 context，如果沒有提供則報錯
        // return next(createHttpError(400, `缺少必要的 'targetId' 欄位 (針對 ${uploadContext})`));
      }
      effectiveTargetId = targetIdFromBody; // 可能是 undefined
      // 在這裡添加針對其他 context 的權限檢查
      // if (!hasPermissionForTarget(userIdFromToken, uploadContext, effectiveTargetId)) {
      //   return next(createHttpError(403, '權限不足'));
      // }
    }
    
    // 呼叫服務刪除圖片
    for (const p of pathsToDelete) {
      await storageService.deleteImage(p);
    }
    
    // 如果是刪除頭像或演唱會的特定圖片，更新相關欄位為空或移除特定URL
    if (uploadContext === 'USER_AVATAR' && effectiveTargetId) {
      const userRepository = AppDataSource.getRepository(User);
      // 使用 token 中的 userId 查找用戶
      const user = await userRepository.findOne({ where: { userId: effectiveTargetId as string } });
      
      if (user) {
        user.avatar = '';
        await userRepository.save(user);
      }
    } else if (uploadContext === 'CONCERT_SEATING_TABLE' && effectiveTargetId) {
      const sessionRepository = AppDataSource.getRepository(ConcertSession);
      const session = await sessionRepository.findOne({ where: { sessionId: effectiveTargetId as string } });
      
      if (session) {
        session.imgSeattable = ''; // 清空座位表圖片
        await sessionRepository.save(session);
      }
    } else if (uploadContext === 'CONCERT_BANNER' && effectiveTargetId) {
      const concertRepository = AppDataSource.getRepository(Concert);
      const concert = await concertRepository.findOne({ where: { concertId: effectiveTargetId as string } });
      
      if (concert) {
        concert.imgBanner = '';
        await concertRepository.save(concert);
      }
    }
    // CONCERT_BANNER 和 VENUE_PHOTO 的刪除可能也需要 DB 更新，如果它們在資料庫中儲存 URL
    
    // 回傳成功回應
    res.status(200).json({
      status: 'success',
      message: '圖片刪除成功'
    });
  } catch (err) {
    next(err);
  }
}

export default {
  uploadImage,
  deleteImage
};
