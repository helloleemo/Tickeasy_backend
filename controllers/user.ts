import { Request, Response } from 'express';
import { AppDataSource } from '../config/database.js';
import { User as UserEntity, RegionOptions, EventTypeOptions, Region, EventType, Gender } from '../models/user.js';
import { UpdateProfileRequest } from '../types/user/requests.js';
import { UserProfileResponse, UserProfileData } from '../types/user/responses.js';
import { handleErrorAsync, ApiError } from '../utils/index.js';
import { ErrorCode, ApiResponse } from '../types/api.js';

// Gender enum 的中英文映射
const genderToChineseMap: Record<Gender, string> = {
  [Gender.MALE]: '男',
  [Gender.FEMALE]: '女',
  [Gender.OTHER]: '其他',
};

const chineseToGenderMap: Record<string, Gender> = {
  '男': Gender.MALE,
  '女': Gender.FEMALE,
  '其他': Gender.OTHER,
};

// 輔助函數：將英文 Gender enum 轉換為中文
function toChineseGender(genderValue?: Gender | null): string | undefined | null {
  if (genderValue === null) return null;
  if (genderValue === undefined) return undefined;
  return genderToChineseMap[genderValue] || undefined;
}

// 輔助函數：將中文性別轉換為 Gender enum (英文)
function toEnglishGender(chineseGender?: string | null): Gender | undefined | null {
  if (chineseGender === null) return null;
  if (chineseGender === undefined) return undefined;
  // 考慮到前端可能傳入 Gender enum 的英文值，先檢查是否直接是 Gender 值
  if (Object.values(Gender).includes(chineseGender as Gender)) {
    return chineseGender as Gender;
  }
  return chineseToGenderMap[chineseGender] || undefined;
}

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

  // 準備回應數據，轉換 gender
  const userProfileData: UserProfileData = {
    ...(selectedUser as unknown as Omit<UserProfileData, 'gender'>), // 轉換基礎部分
    gender: toChineseGender(selectedUser.gender), // selectedUser.gender 是 Gender | null
  };

  return res.status(200).json({
    status: 'success',
    message: '獲取用戶資料成功',
    data: {
      user: userProfileData
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
  const authenticatedUser = req.user as { userId: string; role: string; email: string; };

  if (!authenticatedUser) {
    throw ApiError.unauthorized();
  }

  const userId = authenticatedUser.userId;
  
  const { 
    name, 
    nickname, 
    phone, 
    birthday, 
    gender: rawGender, //接收原始的 gender 輸入
    address, 
    country,
    preferredRegions, 
    preferredEventTypes 
  } = req.body as UpdateProfileRequest;
  
  const userRepository = AppDataSource.getRepository(UserEntity);
  const user = await userRepository.findOne({ where: { userId } });
  
  if (!user) {
    throw ApiError.notFound('用戶');
  }
  
  if (name !== undefined) user.name = name;
  if (nickname !== undefined) user.nickname = nickname;
  if (phone !== undefined) user.phone = phone;

  if (birthday !== undefined) {
    if (birthday === null) {
      user.birthday = null;
    } else if (typeof birthday === 'string' && birthday.trim() === '') {
      throw ApiError.create(400, '生日欄位格式錯誤：如需清空生日，請傳遞 null；否則請提供有效的日期字串。', ErrorCode.DATA_INVALID);
    } else {
      const dateObj = birthday instanceof Date ? birthday : new Date(birthday);
      if (isNaN(dateObj.getTime())) {
        throw ApiError.create(400, '生日欄位格式錯誤：請提供有效的日期字串 (例如 "YYYY-MM-DD")。', ErrorCode.DATA_INVALID);
      }
      user.birthday = dateObj;
    }
  }

  if (rawGender !== undefined) {
    if (rawGender === null) {
      user.gender = null;
    } else if (typeof rawGender === 'string' && rawGender.trim() === '') {
      throw ApiError.create(400, '性別欄位不能為空字串。如需清除，請傳遞 null。有效值為 "男", "女", "其他"。', ErrorCode.DATA_INVALID);
    } else if (typeof rawGender === 'string') {
      const englishGender = toEnglishGender(rawGender);
      if (englishGender === undefined) { 
        throw ApiError.create(400, `性別欄位包含無效的值: "${rawGender}"。有效值為 "男", "女", "其他"。`, ErrorCode.DATA_INVALID);
      }
      user.gender = englishGender; 
    } else {
      throw ApiError.create(400, '性別欄位格式不正確。', ErrorCode.DATA_INVALID);
    }
  }

  if (address !== undefined) user.address = address;
  if (country !== undefined) user.country = country;

  if (preferredRegions !== undefined) {
    if (!Array.isArray(preferredRegions) || !preferredRegions.every(isValidRegion)) {
      throw ApiError.create(400, 'preferredRegions 包含無效的值', ErrorCode.DATA_INVALID);
    }
    user.preferredRegions = preferredRegions as Region[]; 
  }

  if (preferredEventTypes !== undefined) {
    if (!Array.isArray(preferredEventTypes) || !preferredEventTypes.every(isValidEventType)) {
      throw ApiError.create(400, 'preferredEventTypes 包含無效的值', ErrorCode.DATA_INVALID);
    }
    user.preferredEventTypes = preferredEventTypes as EventType[]; 
  }
  
  await userRepository.save(user);
  
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

  // 準備回應數據，轉換 gender
  const userProfileDataForResponse: UserProfileData = {
    ...(updatedSelectedUser as unknown as UserProfileData), // 先進行基礎類型轉換
    gender: toChineseGender(updatedSelectedUser.gender), // updatedSelectedUser.gender 現在是 Gender | null
  };

  return res.status(200).json({
    status: 'success',
    message: '用戶資料更新成功',
    data: {
      user: userProfileDataForResponse
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