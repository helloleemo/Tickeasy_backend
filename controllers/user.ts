import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { User as UserEntity, RegionOptions, EventTypeOptions, Region, EventType } from '../models/user';
import { ApiResponse, UpdateProfileRequest, UserProfileResponse, UserProfileData, ErrorCode } from '../types';
import { handleErrorAsync, ApiError } from '../utils';

/**
 * 獲取用戶個人資料
 */
export const getUserProfile = handleErrorAsync(async (req: Request, res: Response<ApiResponse<UserProfileResponse>>) => {
  // req.user 由 isAuth 中間件設置，包含 userId, email, role
  // const authenticatedUser = req.user as Express.User;
  const authenticatedUser = req.user as { userId: string; role: string; email: string; };

  if (!authenticatedUser) {
    throw ApiError.unauthorized();
  }

  const userId = authenticatedUser.userId;

  // 使用 TypeORM 查找用戶，並只選擇指定的欄位
  const userRepository = AppDataSource.getRepository(UserEntity);
  const selectedUser = await userRepository.findOne({
    where: { userId: userId },
    select: [
      'userId',
      'email',
      'name',
      'nickname',
      'role',
      'phone',
      'birthday',
      'gender',
      'preferredRegions',
      'preferredEventTypes',
      'country',
      'address',
      'avatar',
      'isEmailVerified',
      'oauthProviders',
      'searchHistory'
    ]
  });

  if (!selectedUser) {
    throw ApiError.notFound('用戶資料');
  }

  // 返回只包含選定欄位的用戶資料
  return res.status(200).json({
    status: 'success',
    message: '獲取用戶資料成功',
    data: {
      user: selectedUser as unknown as UserProfileData
    }
  });
});

// 輔助函數：檢查是否為有效的 Region 值
function isValidRegion(value: string): value is Region {
  return Object.values(Region).includes(value as Region);
}

// 輔助函數：檢查是否為有效的 EventType 值
function isValidEventType(value: string): value is EventType {
  return Object.values(EventType).includes(value as EventType);
}

/**
 * 更新用戶個人資料
 */
export const updateUserProfile = handleErrorAsync(async (req: Request, res: Response<ApiResponse<UserProfileResponse>>) => {
  // const userId = (req.user as Express.User)?.userId;
  const authenticatedUser = req.user as { userId: string; role: string; email: string; };

  if (!authenticatedUser) {
    throw ApiError.unauthorized();
  }

  const userId = authenticatedUser.userId;
  
  // 從請求中獲取要更新的字段
  const { 
    name, 
    nickname, 
    phone, 
    birthday, 
    gender, 
    address, 
    country,
    preferredRegions, 
    preferredEventTypes 
  } = req.body as UpdateProfileRequest;
  
  // 查找用戶
  const userRepository = AppDataSource.getRepository(UserEntity);
  const user = await userRepository.findOne({ where: { userId } });
  
  if (!user) {
    throw ApiError.notFound('用戶');
  }
  
  // 更新用戶資料
  // 使用 xxx !== undefined 判斷更嚴謹，允許傳入空字符串或 null (如果業務邏輯允許)
  if (name !== undefined) user.name = name;
  if (nickname !== undefined) user.nickname = nickname;
  if (phone !== undefined) user.phone = phone;
  if (birthday !== undefined) user.birthday = birthday instanceof Date ? birthday : new Date(birthday);
  if (gender !== undefined) user.gender = gender;
  if (address !== undefined) user.address = address;
  if (country !== undefined) user.country = country;

  // 驗證和更新 preferredRegions
  if (preferredRegions !== undefined) {
    if (!Array.isArray(preferredRegions) || !preferredRegions.every(isValidRegion)) {
      throw ApiError.create(400, 'preferredRegions 包含無效的值', ErrorCode.DATA_INVALID);
    }
    user.preferredRegions = preferredRegions as Region[]; 
  }

  // 驗證和更新 preferredEventTypes
  if (preferredEventTypes !== undefined) {
    if (!Array.isArray(preferredEventTypes) || !preferredEventTypes.every(isValidEventType)) {
      throw ApiError.create(400, 'preferredEventTypes 包含無效的值', ErrorCode.DATA_INVALID);
    }
    user.preferredEventTypes = preferredEventTypes as EventType[]; 
  }
  
  // 保存更新
  await userRepository.save(user);
  
  // 返回更新後的用戶數據 (可以考慮返回完整的 user 對象，或只選擇部分字段)
  // 為了與 GET /profile 保持一致，也只選擇指定字段
  const updatedSelectedUser = await userRepository.findOne({
    where: { userId: userId },
    select: [
      'userId', 'email', 'name', 'nickname', 'role', 'phone', 'birthday',
      'gender', 'preferredRegions', 'preferredEventTypes', 'country', 
      'address', 'avatar', 'isEmailVerified', 'oauthProviders', 'searchHistory'
    ]
  });

  if (!updatedSelectedUser) {
    throw ApiError.systemError();
  }

  return res.status(200).json({
    status: 'success',
    message: '用戶資料更新成功',
    data: {
      user: updatedSelectedUser as unknown as UserProfileData
    }
  });
});

// 英文地區鍵名到英文子標籤的映射
const regionSubLabelMap: Record<string, string> = {
  NORTH: 'North',
  SOUTH: 'South',
  EAST: 'East',
  CENTRAL: 'Central',
  ISLANDS: 'Outlying Islands',
  OVERSEAS: 'Overseas'
};

/**
 * 獲取地區選項 (新格式)
 */
export const getRegionOptions = handleErrorAsync(async (req: Request, res: Response<ApiResponse<any>>) => {
  // 將 RegionOptions 轉換為前端期望的格式
  const formattedOptions = RegionOptions.map(option => ({
    label: option.value, // 中文標籤
    value: option.value, // 值 (與中文標籤相同)
    subLabel: regionSubLabelMap[option.key] || option.key // 英文子標籤 (從映射獲取，如果沒有則備用 key)
  }));
  
  return res.status(200).json({
    status: 'success',
    message: '獲取地區選項成功',
    data: formattedOptions // 返回轉換後的格式
  });
});

// 英文鍵名到英文子標籤的映射
const eventTypeSubLabelMap: Record<string, string> = {
  POP: 'Pop',
  ROCK: 'Rock',
  ELECTRONIC: 'Electronic',
  HIP_HOP: 'Hip-Hop/Rap', // 根據前端需求調整
  JAZZ_BLUES: 'Jazz/Blues', // 根據前端需求調整
  CLASSICAL: 'Classical/Symphony', // 根據前端需求調整
  OTHER: 'Other'
};

/**
 * 獲取活動類型選項 (新格式)
 */
export const getEventTypeOptions = handleErrorAsync(async (req: Request, res: Response<ApiResponse<any>>) => {
  // 將 EventTypeOptions 轉換為前端期望的格式
  const formattedOptions = EventTypeOptions.map(option => ({
    label: option.value, // 中文標籤
    value: option.value, // 值 (與中文標籤相同)
    subLabel: eventTypeSubLabelMap[option.key] || option.key // 英文子標籤 (從映射獲取，如果沒有則備用 key)
  }));
  
  return res.status(200).json({
    status: 'success',
    message: '獲取活動類型選項成功',
    data: formattedOptions // 返回轉換後的格式
  });
}); 