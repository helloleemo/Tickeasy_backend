import jwt from 'jsonwebtoken';
import { User as UserEntity } from '../models/user';
import { Request, Response, NextFunction } from 'express';
import { TokenPayload } from '../types/auth/jwt';
import { AppDataSource } from '../config/database';
import { ApiError } from '../utils';
import { ErrorCode } from '../types'; // Removed as ErrorCode is not exported

/**
 * 驗證用戶是否已登入的中間件
 */
export const isAuthenticated = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 獲取Authorization頭
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApiError.unauthorized();
    }

    // 獲取令牌
    const token = authHeader.split(' ')[1];
    if (!token) {
      throw ApiError.unauthorized();
    }

    // 驗證令牌
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret') as TokenPayload;
    if (!decoded.userId) {
      throw ApiError.create(401, '無效的認證令牌', ErrorCode.AUTH_TOKEN_INVALID); // Replaced with a string literal
    }

    // 查找用戶
    const userRepository = AppDataSource.getRepository(UserEntity);
    const user = await userRepository.findOne({ where: { userId: decoded.userId } });
    if (!user) {
      throw ApiError.notFound('用戶');
    }

    // 在請求對象中設置用戶信息
    req.user = {
      userId: user.userId,
      role: user.role,
      email: user.email,
      name: user.name,
      isEmailVerified: user.isEmailVerified
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(ApiError.create(401, '無效的認證令牌', ErrorCode.AUTH_TOKEN_INVALID));
    }
    next(error);
  }
};

/**
 * 可選的身份驗證中間件
 * 如果提供了令牌則驗證，未提供則跳過但不阻止請求
 */
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 獲取Authorization頭
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    // 獲取令牌
    const token = authHeader.split(' ')[1];
    if (!token) {
      return next();
    }

    try {
      // 驗證令牌
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret') as TokenPayload;
      if (!decoded.userId) {
        return next();
      }

      // 查找用戶
      const userRepository = AppDataSource.getRepository(UserEntity);
      const user = await userRepository.findOne({ where: { userId: decoded.userId } });
      if (!user) {
        return next();
      }

      // 在請求對象中設置用戶信息
      req.user = {
        userId: user.userId,
        role: user.role,
        email: user.email,
        name: user.name,
        isEmailVerified: user.isEmailVerified
      };
    } catch (error) {
      // 對於可選驗證，忽略令牌錯誤
      console.log(error);
    }

    next();
  } catch (error) {
    // 對於可選驗證，忽略令牌錯誤
    next();
    console.log(error);
  }
};

/**
 * 驗證用戶是否為管理員的中間件
 */
export const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw ApiError.unauthorized();
    }

    // 確保有正確的類型檢查
    const user = req.user as any;
    const userRole = String(user.role).toLowerCase();
    if (userRole !== 'admin') {
      throw ApiError.forbidden();
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * 管理員權限驗證中間件
 */
export const adminAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await isAuthenticated(req, res, (err) => {
      if (err) {
        return next(err);
      }
      
      if (req.user) {
        const user = req.user as any;
        const userRole = String(user.role).toLowerCase();
        if (userRole !== 'admin' && userRole !== 'superuser') {
          throw ApiError.forbidden();
        }
      }
      next();
    });
  } catch (error) {
    next(ApiError.unauthorized());
    console.log(error);
  }
};
