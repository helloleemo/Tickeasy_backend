import { Request, Response } from 'express';
import { AppDataSource } from '../config/database.js';
import { IsNull } from 'typeorm';
import { Concert } from '../models/concert.js';
// import { Venue } from '../models/venue.js';
import { TicketType } from '../models/ticket-type.js';
import { handleErrorAsync } from '../utils/handleErrorAsync.js';
import { ApiError } from '../utils/index.js';
import {
  CreateConcertRequest,
  ConcertResponse,
  ConcertSessionResponse,
} from './../types/concert/index.js';
import { ErrorCode } from '../types/api.js';
import { ConcertSession } from '../models/concert-session.js';
import { Venue } from '../models/venue.js';
import concertImageService from '../services/concertImageService.js';
import { LocationTag } from '../models/location-tag.js';
import { MusicTag } from '../models/music-tag.js';
import concertReviewService from '../services/concertReviewService.js';

/**
 * INDEX
 * 1. 建立活動
 * 2. 修改活動
 * 3. 獲得場地的資料
 * 4. 取得熱門活動
 * 5. 增加visitCount
 * 6. 設定promotion權重
 * 7. 搜尋活動
 * 8. 獲得首頁promo的banner
 * 9. 提交演唱會審核
 * 10. 獲得演唱會詳細資料
 * 11. 獲得location tags
 * 12. 獲得music tags
 * 13. 軟刪除演唱會
 * 14. 複製演唱會
 * 15. 檢查演唱會名字是否重複
 */

// ------------1. 建立活動-------------
export const createConcert = handleErrorAsync(
  async (req: Request, res: Response<ConcertResponse>) => {
    // 驗證
    const authenticatedUser = req.user as { userId: string }; // 來自 isAuthenticated
    if (!authenticatedUser || !authenticatedUser.userId) {
      throw ApiError.unauthorized();
    }

    const {
      organizationId,
      venueId,
      locationTagId,
      musicTagId,
      title,
      introduction,
      location,
      address,
      eventStartDate,
      eventEndDate,
      ticketPurchaseMethod,
      precautions,
      refundPolicy,
      conInfoStatus,
      imgBanner,
      sessions,
    } = req.body as CreateConcertRequest;

    // 是否為草稿狀態
    const isDraft = conInfoStatus === 'draft';
    // 草稿後端不驗證

    // --- 基本驗證 ---
    // 驗證活動
    if (!isDraft) {
      if (
        !organizationId ||
        !venueId ||
        !locationTagId ||
        !musicTagId ||
        !title ||
        !introduction ||
        !location ||
        !address ||
        !eventStartDate ||
        !eventEndDate ||
        !ticketPurchaseMethod ||
        !precautions ||
        !refundPolicy ||
        !conInfoStatus
      ) {
        throw ApiError.fieldRequired('所有欄位');
      }

      if (!imgBanner) {
        throw ApiError.fieldRequired('主視覺與座位圖');
      }

      const startDate = new Date(eventStartDate);
      const endDate = new Date(eventEndDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw ApiError.invalidFormat('活動開始與結束日期');
      }
      if (startDate >= endDate) {
        throw ApiError.invalidFormat('活動結束時間必須晚於開始時間，');
      }
    }

    // 驗證 session
    if (!isDraft) {
      if (!Array.isArray(sessions) || sessions.length === 0) {
        throw ApiError.fieldRequired('至少需要一場場次');
      }

      for (const session of sessions) {
        if (
          !session.sessionTitle ||
          !session.sessionDate ||
          !session.sessionStart ||
          !session.sessionEnd ||
          !session.imgSeattable ||
          !Array.isArray(session.ticketTypes)
        ) {
          throw ApiError.invalidFormat('場次資料格式錯誤');
        }

        for (const ticket of session.ticketTypes) {
          if (
            !ticket.ticketTypeName ||
            !ticket.entranceType ||
            !ticket.ticketBenefits ||
            !ticket.ticketRefundPolicy ||
            typeof ticket.ticketTypePrice !== 'number' ||
            ticket.ticketTypePrice < 0 ||
            typeof ticket.totalQuantity !== 'number' ||
            ticket.totalQuantity <= 0 ||
            !ticket.sellBeginDate ||
            !ticket.sellEndDate
          ) {
            throw ApiError.invalidFormat('票種資料格式錯誤');
          }

          const sellStart = new Date(ticket.sellBeginDate);
          const sellEnd = new Date(ticket.sellEndDate);
          if (sellStart >= sellEnd) {
            throw ApiError.invalidFormat('售票結束時間必須晚於開始時間');
          }
        }
      }
    }

    // --- 驗證結束 ---

    const concertRepository = AppDataSource.getRepository(Concert);
    const sessionRepository = AppDataSource.getRepository(ConcertSession);
    const ticketTypeRepository = AppDataSource.getRepository(TicketType);

    // 檢查名稱是否重複
    const existingConcert = await concertRepository.findOne({
      where: { conTitle: title, cancelledAt: IsNull() },
    });
    if (existingConcert) {
      throw ApiError.create(
        409,
        '此活動名稱已被使用',
        ErrorCode.DATA_ALREADY_EXISTS
      );
    }

    // 建立concert
    const concertData: Partial<Concert> = {
      organizationId,
      venueId,
      locationTagId,
      musicTagId,
      conTitle: title,
      conIntroduction: introduction ?? '',
      conLocation: location ?? '',
      conAddress: address ?? '',
      eventStartDate: eventStartDate ? new Date(eventStartDate) : undefined,
      eventEndDate: eventEndDate ? new Date(eventEndDate) : undefined,
      imgBanner,
      ticketPurchaseMethod,
      precautions,
      refundPolicy,
      conInfoStatus: 'draft', // 強制設為草稿狀態
    };
    const newConcert = concertRepository.create(concertData);
    const savedConcert = await concertRepository.save(newConcert);

    // 處理音樂會橫幅圖片
    if (imgBanner) {
      savedConcert.imgBanner = await concertImageService.processConcertBanner(
        imgBanner,
        savedConcert.concertId,
        savedConcert.conTitle
      );
      await concertRepository.save(savedConcert);
    }

    // 建立 sessions 跟 ticketTypes
    const savedSessions: ConcertSessionResponse[] = [];
    for (const session of sessions) {
      const sessionEntity = sessionRepository.create({
        concert: savedConcert,
        sessionTitle: session.sessionTitle,
        sessionDate: new Date(session.sessionDate),
        sessionStart: session.sessionStart,
        sessionEnd: session.sessionEnd,
        imgSeattable: session.imgSeattable,
      });
      const savedSession = await sessionRepository.save(sessionEntity);

      // 處理座位表圖片
      if (session.imgSeattable) {
        try {
          savedSession.imgSeattable =
            await concertImageService.processConcertSeatingTable(
              session.imgSeattable,
              savedSession.sessionId,
              savedSession.sessionTitle
            );
          await sessionRepository.save(savedSession);
        } catch (error) {
          // 如果圖片處理失敗，刪除已建立的 concert 和相關 session 記錄
          await concertRepository.remove(savedConcert);
          throw error; // 重新拋出錯誤
        }
      }

      const ticketEntities = session.ticketTypes.map((ticket) =>
        ticketTypeRepository.create({
          concertSession: savedSession,
          ticketTypeName: ticket.ticketTypeName,
          entranceType: ticket.entranceType,
          ticketBenefits: ticket.ticketBenefits,
          ticketRefundPolicy: ticket.ticketRefundPolicy,
          ticketTypePrice: ticket.ticketTypePrice,
          totalQuantity: ticket.totalQuantity,
          remainingQuantity: ticket.totalQuantity,
          sellBeginDate: new Date(ticket.sellBeginDate),
          sellEndDate: new Date(ticket.sellEndDate),
        })
      );
      const savedTickets = await ticketTypeRepository.save(ticketEntities);
      savedSessions.push({
        sessionId: savedSession.sessionId,
        sessionTitle: savedSession.sessionTitle,
        sessionDate: new Date(savedSession.sessionDate).toISOString(),
        sessionStart: savedSession.sessionStart,
        sessionEnd: savedSession.sessionEnd,
        imgSeattable: savedSession.imgSeattable,
        ticketTypes: savedTickets.map((ticket) => ({
          ticketTypeId: ticket.ticketTypeId,
          ticketTypeName: ticket.ticketTypeName,
          entranceType: ticket.entranceType,
          ticketBenefits: ticket.ticketBenefits,
          ticketRefundPolicy: ticket.ticketRefundPolicy,
          ticketTypePrice: ticket.ticketTypePrice,
          totalQuantity: ticket.totalQuantity,
          remainingQuantity: ticket.remainingQuantity,
          sellBeginDate: ticket.sellBeginDate.toISOString(),
          sellEndDate: ticket.sellEndDate.toISOString(),
        })),
      });
    }

    // 成功！
    res.status(201).json({
      status: 'success',
      message: '演唱會活動建立成功！',
      data: {
        concert: {
          concertId: savedConcert.concertId,
          organizationId: savedConcert.organizationId,
          venueId: savedConcert.venueId,
          locationTagId: savedConcert.locationTagId,
          musicTagId: savedConcert.musicTagId,
          conTitle: savedConcert.conTitle,
          conIntroduction: savedConcert.conIntroduction,
          conLocation: savedConcert.conLocation,
          conAddress: savedConcert.conAddress,
          eventStartDate:
            savedConcert.eventStartDate?.toISOString() ?? undefined,
          eventEndDate: savedConcert.eventEndDate?.toISOString() ?? undefined,
          imgBanner: savedConcert.imgBanner,
          ticketPurchaseMethod: savedConcert.ticketPurchaseMethod,
          precautions: savedConcert.precautions,
          refundPolicy: savedConcert.refundPolicy,
          conInfoStatus: savedConcert.conInfoStatus,
          reviewStatus: savedConcert.reviewStatus,
          visitCount: savedConcert.visitCount,
          promotion: savedConcert.promotion ?? 0,
          cancelledAt: savedConcert.cancelledAt?.toISOString() ?? undefined,
          createdAt: savedConcert.createdAt.toISOString(),
          updatedAt: savedConcert.updatedAt.toISOString(),
          sessions: savedSessions,
        },
      },
    });
  }
);

// ------------2. 修改活動-------------
export const updateConcert = handleErrorAsync(
  async (req: Request, res: Response<ConcertResponse>) => {
    const authenticatedUser = req.user as { userId: string };
    if (!authenticatedUser?.userId) {
      throw ApiError.unauthorized();
    }

    const concertId = req.params.concertId;

    const {
      organizationId,
      venueId,
      locationTagId,
      musicTagId,
      title,
      introduction,
      location,
      address,
      eventStartDate,
      eventEndDate,
      ticketPurchaseMethod,
      precautions,
      refundPolicy,
      conInfoStatus,
      imgBanner,
      sessions,
    } = req.body as CreateConcertRequest;

    const concertRepository = AppDataSource.getRepository(Concert);
    const sessionRepository = AppDataSource.getRepository(ConcertSession);
    const ticketTypeRepository = AppDataSource.getRepository(TicketType);

    // const concert = await concertRepository.findOneBy({ concertId });
    const concert = await concertRepository.findOne({
      where: { concertId, cancelledAt: IsNull() },
    });

    if (!concert) {
      throw ApiError.notFound('演唱會不存在');
    }

    if (
      concert.conInfoStatus !== 'draft' &&
      concert.conInfoStatus !== 'rejected'
    ) {
      throw ApiError.badRequest('僅能編輯草稿或被退回的演唱會');
    }

    const isDraft = conInfoStatus === 'draft';

    // ---------- 驗證主資料 ----------
    if (!isDraft) {
      if (
        !organizationId ||
        !venueId ||
        !locationTagId ||
        !musicTagId ||
        !title ||
        !introduction ||
        !location ||
        !address ||
        !eventStartDate ||
        !eventEndDate ||
        !ticketPurchaseMethod ||
        !precautions ||
        !refundPolicy ||
        !conInfoStatus
      ) {
        throw ApiError.fieldRequired('所有欄位');
      }

      if (!imgBanner) {
        throw ApiError.fieldRequired('主視覺');
      }

      const startDate = new Date(eventStartDate);
      const endDate = new Date(eventEndDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw ApiError.invalidFormat('活動日期格式錯誤');
      }
      if (startDate >= endDate) {
        throw ApiError.invalidFormat('結束時間需晚於開始時間');
      }
    }

    // ---------- 處理音樂會橫幅圖片更新 ----------
    const newBannerUrl = await concertImageService.updateConcertBanner(
      imgBanner,
      concert.imgBanner,
      concertId
    );

    // ---------- 更新主資料 ----------
    concert.organizationId = organizationId;
    concert.venueId = venueId;
    concert.locationTagId = locationTagId;
    concert.musicTagId = musicTagId;
    concert.conTitle = title;
    concert.conIntroduction = introduction ?? '';
    concert.conLocation = location ?? '';
    concert.conAddress = address ?? '';
    concert.eventStartDate = eventStartDate ? new Date(eventStartDate) : null;
    concert.eventEndDate = eventEndDate ? new Date(eventEndDate) : null;
    concert.ticketPurchaseMethod = ticketPurchaseMethod;
    concert.precautions = precautions;
    concert.refundPolicy = refundPolicy;
    // conInfoStatus 不允許前端修改，保持原本狀態，只能透過專門的端點改變
    concert.imgBanner = newBannerUrl;

    await concertRepository.save(concert);

    // ---------- 刪除並重建 sessions ----------
    await sessionRepository.delete({ concert: { concertId } });

    const savedSessions: ConcertSessionResponse[] = [];
    for (const session of sessions) {
      if (!isDraft) {
        if (
          !session.sessionTitle ||
          !session.sessionDate ||
          !session.sessionStart ||
          !session.sessionEnd ||
          !session.imgSeattable ||
          !Array.isArray(session.ticketTypes)
        ) {
          throw ApiError.invalidFormat('場次格式錯誤');
        }
      }

      const sessionEntity = sessionRepository.create({
        concert,
        sessionTitle: session.sessionTitle,
        sessionDate: new Date(session.sessionDate),
        sessionStart: session.sessionStart,
        sessionEnd: session.sessionEnd,
        imgSeattable: session.imgSeattable,
      });
      const savedSession = await sessionRepository.save(sessionEntity);

      // ---------- 處理座位表圖片 ----------
      if (session.imgSeattable) {
        savedSession.imgSeattable =
          await concertImageService.processConcertSeatingTable(
            session.imgSeattable,
            savedSession.sessionId,
            savedSession.sessionTitle
          );
        await sessionRepository.save(savedSession);
      }

      const ticketEntities =
        session.ticketTypes?.map((ticket) => {
          if (!isDraft) {
            if (
              !ticket.ticketTypeName ||
              !ticket.entranceType ||
              !ticket.ticketBenefits ||
              !ticket.ticketRefundPolicy ||
              typeof ticket.ticketTypePrice !== 'number' ||
              ticket.ticketTypePrice < 0 ||
              typeof ticket.totalQuantity !== 'number' ||
              ticket.totalQuantity <= 0 ||
              !ticket.sellBeginDate ||
              !ticket.sellEndDate
            ) {
              throw ApiError.invalidFormat('票種格式錯誤');
            }

            const sellStart = new Date(ticket.sellBeginDate);
            const sellEnd = new Date(ticket.sellEndDate);
            if (sellStart >= sellEnd) {
              throw ApiError.invalidFormat('售票結束需晚於開始');
            }
          }

          return ticketTypeRepository.create({
            concertSession: savedSession,
            ticketTypeName: ticket.ticketTypeName,
            entranceType: ticket.entranceType,
            ticketBenefits: ticket.ticketBenefits,
            ticketRefundPolicy: ticket.ticketRefundPolicy,
            ticketTypePrice: ticket.ticketTypePrice,
            totalQuantity: ticket.totalQuantity,
            remainingQuantity: ticket.totalQuantity,
            sellBeginDate: new Date(ticket.sellBeginDate),
            sellEndDate: new Date(ticket.sellEndDate),
          });
        }) ?? [];

      const savedTickets = await ticketTypeRepository.save(ticketEntities);

      savedSessions.push({
        sessionId: savedSession.sessionId,
        sessionTitle: savedSession.sessionTitle,
        sessionDate: savedSession.sessionDate.toISOString(),
        sessionStart: savedSession.sessionStart,
        sessionEnd: savedSession.sessionEnd,
        imgSeattable: savedSession.imgSeattable,
        ticketTypes: savedTickets.map((ticket) => ({
          ticketTypeId: ticket.ticketTypeId,
          ticketTypeName: ticket.ticketTypeName,
          entranceType: ticket.entranceType,
          ticketBenefits: ticket.ticketBenefits,
          ticketRefundPolicy: ticket.ticketRefundPolicy,
          ticketTypePrice: ticket.ticketTypePrice,
          totalQuantity: ticket.totalQuantity,
          remainingQuantity: ticket.remainingQuantity,
          sellBeginDate: ticket.sellBeginDate.toISOString(),
          sellEndDate: ticket.sellEndDate.toISOString(),
        })),
      });
    }

    res.status(200).json({
      status: 'success',
      message: '演唱會內容更新成功',
      data: {
        concert: {
          concertId: concert.concertId,
          organizationId: concert.organizationId,
          venueId: concert.venueId,
          locationTagId: concert.locationTagId,
          musicTagId: concert.musicTagId,
          conTitle: concert.conTitle,
          conIntroduction: concert.conIntroduction,
          conLocation: concert.conLocation,
          conAddress: concert.conAddress,
          eventStartDate: concert.eventStartDate?.toISOString() ?? undefined,
          eventEndDate: concert.eventEndDate?.toISOString() ?? undefined,
          imgBanner: concert.imgBanner,
          ticketPurchaseMethod: concert.ticketPurchaseMethod,
          precautions: concert.precautions,
          refundPolicy: concert.refundPolicy,
          conInfoStatus: concert.conInfoStatus,
          reviewStatus: concert.reviewStatus,
          visitCount: concert.visitCount,
          promotion: concert.promotion ?? 0,
          cancelledAt: concert.cancelledAt?.toISOString() ?? undefined,
          createdAt: concert.createdAt.toISOString(),
          updatedAt: concert.updatedAt.toISOString(),
          sessions: savedSessions,
        },
      },
    });
  }
);

// ------------3. 獲得場地的資料-------------
export const getAllVenues = handleErrorAsync(
  async (req: Request, res: Response) => {
    const venueRepository = AppDataSource.getRepository(Venue);
    const venues = await venueRepository.find();
    res.status(200).json({
      message: '成功取得場館資料',
      status: 'success',
      data: venues,
    });
  }
);

// ------------4. 取得熱門活動-------------
// 取得熱門活動, 首頁
// 先依據promotion權重降序，若promotion相同，再依visitCount排序
export const getPopularConcerts = handleErrorAsync(
  async (req: Request, res: Response) => {
    const concertRepository = AppDataSource.getRepository(Concert);
    const take = Number(req.query.take) || 3;

    const popularConcerts = await concertRepository.find({
      where: {
        conInfoStatus: 'published', // 僅顯示已發佈活動
        cancelledAt: IsNull(), // 不顯示已取消的活動
      },
      order: {
        promotion: 'ASC',
        visitCount: 'ASC',
      },
      take,
      select: [
        'concertId',
        'conTitle',
        'conIntroduction',
        'imgBanner',
        'promotion',
        'visitCount',
      ],
    });

    if (!popularConcerts.length) {
      throw ApiError.notFound('熱門演唱會資料');
    }

    res.status(200).json({
      message: '取得資料成功',
      status: 'success',
      data: popularConcerts,
    });
  }
);

//------------5. 增加visitCount-------------
export const incrementVisitCount = handleErrorAsync(
  async (req: Request, res: Response) => {
    const concertId = req.params.concertId;
    const concertRepo = AppDataSource.getRepository(Concert);

    const concert = await concertRepo.findOne({
      where: { concertId, cancelledAt: IsNull() },
    });
    if (!concert) throw ApiError.notFound('演唱會不存在');

    concert.visitCount += 1;
    await concertRepo.save(concert);

    res.status(200).json({
      status: 'success',
      message: '參觀人數已增加',
      data: { visitCount: concert.visitCount },
    });
  }
);

//------------6. 設定promotion權重-------------
export const updatePromotion = handleErrorAsync(
  async (req: Request, res: Response) => {
    const concertId = req.params.concertId;
    const { promotion } = req.body as { promotion: number };

    if (typeof promotion !== 'number' || promotion < 0) {
      throw ApiError.invalidFormat('promotion 欄位必須為非負整數');
    }

    const concertRepo = AppDataSource.getRepository(Concert);
    const concert = await concertRepo.findOne({
      where: { concertId, cancelledAt: IsNull() },
    });

    if (!concert) throw ApiError.notFound('演唱會不存在');

    concert.promotion = promotion;
    await concertRepo.save(concert);

    res.status(200).json({
      status: 'success',
      message: 'promotion 權重更新成功',
      data: { concertId, promotion },
    });
  }
);

//------------7. 搜尋活動----------------
export const searchConcerts = handleErrorAsync(
  async (req: Request, res: Response) => {
    const concertRepository = AppDataSource.getRepository(Concert);
    const {
      keyword = '',
      locationTagId,
      musicTagId,
      startDate,
      endDate,
      page = 1,
      perPage = 10,
      sortedBy = 'newToOld',
    } = req.query as Record<string, string>;

    const take = parseInt(perPage.toString(), 10);
    const skip = (parseInt(page.toString(), 10) - 1) * take;

    const query = concertRepository
      .createQueryBuilder('concert')
      .leftJoinAndSelect('concert.venue', 'venue')
      .leftJoinAndSelect('concert.locationTag', 'locationTag')
      .leftJoinAndSelect('concert.musicTag', 'musicTag')
      .where(
        'concert.conInfoStatus = :status AND concert.cancelledAt IS NULL',
        { status: 'published' }
      );

    if (keyword) {
      query.andWhere(
        '(concert.conTitle ILIKE :keyword OR concert.conIntroduction ILIKE :keyword)',
        { keyword: `%${keyword}%` }
      );
    }

    if (locationTagId) {
      query.andWhere('concert.locationTagId = :locationTagId', {
        locationTagId,
      });
    }

    if (musicTagId) {
      query.andWhere('concert.musicTagId = :musicTagId', { musicTagId });
    }

    if (startDate) {
      query.andWhere('concert.eventStartDate >= :startDate', {
        startDate,
      });
    }

    if (endDate) {
      query.andWhere('concert.eventEndDate <= :endDate', { endDate });
    }

    if (sortedBy === 'newToOld') {
      query.orderBy('concert.eventStartDate', 'DESC');
    } else if (sortedBy === 'oldToNew') {
      query.orderBy('concert.eventStartDate', 'ASC');
    }

    const [concerts, count] = await query
      .skip(skip)
      .take(take)
      .getManyAndCount();
    console.log('concerts', concerts);
    const result = concerts.map((concert) => ({
      concertId: concert.concertId,
      conTitle: concert.conTitle,
      conIntroduction: concert.conIntroduction,
      conAddress: concert.conAddress,
      eventStartDate: concert.eventStartDate,
      eventEndDate: concert.eventEndDate,
      imgBanner: concert.imgBanner,
      venueName: (concert as any).venue?.venueName,
      locationTagName: (concert as any).locationTag?.locationTagName,
      musicTagName: (concert as any).musicTag?.musicTagName,
    }));

    if (!result.length) {
      throw ApiError.notFound('演唱會資料');
    }

    res.status(200).json({
      status: 'success',
      message: '成功取得搜尋資料',
      data: result,
      page: parseInt(page.toString(), 10),
      perPage: take,
      count,
      totalPages: Math.ceil(count / take),
      sortedBy,
    });
  }
);

//---------8. 獲得首頁promo的banner--------
export const getBannerConcerts = handleErrorAsync(
  async (req: Request, res: Response) => {
    const concertRepository = AppDataSource.getRepository(Concert);

    const concerts = await concertRepository.find({
      where: {
        conInfoStatus: 'published',
        cancelledAt: IsNull(),
      },
      order: {
        promotion: 'ASC',
        visitCount: 'ASC',
      },
      select: [
        'concertId',
        'conTitle',
        'conIntroduction',
        'imgBanner',
        'promotion',
        'visitCount',
      ],
      take: 5,
    });

    if (!concerts.length) {
      throw ApiError.notFound('熱門活動banner');
    }

    res.status(200).json({
      message: '取得資料成功',
      status: 'success',
      data: concerts,
    });
  }
);

// ------------09. 提交演唱會審核-------------
export const submitConcertForReview = handleErrorAsync(
  async (req: Request, res: Response) => {
    const authenticatedUser = req.user as { userId: string };
    if (!authenticatedUser?.userId) {
      throw ApiError.unauthorized();
    }

    const concertId = req.params.concertId;
    const concertRepository = AppDataSource.getRepository(Concert);

    // 查找演唱會
    const concert = await concertRepository.findOne({
      where: { concertId },
      relations: ['sessions', 'sessions.ticketTypes'],
    });

    if (!concert) {
      throw ApiError.notFound('演唱會不存在');
    }

    // 檢查權限：只能操作自己組織的演唱會
    // TODO: 這裡可能需要檢查用戶是否屬於該組織

    // 檢查狀態：只有草稿可以提交審核
    if (concert.conInfoStatus !== 'draft') {
      throw ApiError.badRequest('只有草稿狀態的演唱會可以提交審核');
    }

    // 驗證演唱會是否完整
    if (
      !concert.organizationId ||
      !concert.venueId ||
      !concert.locationTagId ||
      !concert.musicTagId ||
      !concert.conTitle ||
      !concert.conIntroduction ||
      !concert.conLocation ||
      !concert.conAddress ||
      !concert.eventStartDate ||
      !concert.eventEndDate ||
      !concert.ticketPurchaseMethod ||
      !concert.precautions ||
      !concert.refundPolicy ||
      !concert.imgBanner
    ) {
      throw ApiError.fieldRequired('演唱會資料不完整，請補齊所有必要欄位');
    }

    // 驗證場次
    if (!concert.sessions || concert.sessions.length === 0) {
      throw ApiError.fieldRequired('至少需要一個場次');
    }

    for (const session of concert.sessions) {
      if (
        !session.sessionTitle ||
        !session.sessionDate ||
        !session.sessionStart ||
        !session.sessionEnd ||
        !session.imgSeattable
      ) {
        throw ApiError.invalidFormat('場次資料不完整');
      }

      if (!session.ticketTypes || session.ticketTypes.length === 0) {
        throw ApiError.fieldRequired('每個場次至少需要一種票種');
      }

      for (const ticket of session.ticketTypes) {
        /**------除錯用--------
         *         
         * console.log('[Ticket Debug]', {
          ticketTypeName: ticket.ticketTypeName,
          entranceType: ticket.entranceType,
          ticketBenefits: ticket.ticketBenefits,
          ticketRefundPolicy: ticket.ticketRefundPolicy,
          ticketTypePrice: ticket.ticketTypePrice,
          typeofPrice: typeof ticket.ticketTypePrice,
          totalQuantity: ticket.totalQuantity,
          sellBeginDate: ticket.sellBeginDate,
          sellEndDate: ticket.sellEndDate,
        });
         */

        // 強制轉型
        ticket.ticketTypePrice = Number(ticket.ticketTypePrice);
        ticket.totalQuantity = Number(ticket.totalQuantity);

        if (
          !ticket.ticketTypeName ||
          !ticket.entranceType ||
          !ticket.ticketBenefits ||
          !ticket.ticketRefundPolicy ||
          typeof ticket.ticketTypePrice !== 'number' ||
          ticket.ticketTypePrice < 0 ||
          typeof ticket.totalQuantity !== 'number' ||
          ticket.totalQuantity <= 0 ||
          !ticket.sellBeginDate ||
          !ticket.sellEndDate
        ) {
          throw ApiError.invalidFormat('票種資料不完整');
        }

        const sellStart = new Date(ticket.sellBeginDate);
        const sellEnd = new Date(ticket.sellEndDate);
        if (sellStart >= sellEnd) {
          throw ApiError.invalidFormat('售票結束時間必須晚於開始時間');
        }
      }
    }

    // 更新狀態為審核中
    concert.conInfoStatus = 'reviewing';
    await concertRepository.save(concert);

    // 非同步觸發 AI 審核，不影響主流程
    concertReviewService.triggerAIReview(concert.concertId)
      .then((aiReview) => {
        console.log(`[AI審核] 演唱會 ${concert.concertId} AI審核已完成，狀態：${aiReview.reviewStatus}`);
      })
      .catch((err) => {
        console.error(`[AI審核] 演唱會 ${concert.concertId} AI審核失敗：`, err);
      });
    //

    res.status(200).json({
      status: 'success',
      message: '演唱會已提交審核，請等待管理員審核',
      data: {
        concertId: concert.concertId,
        conInfoStatus: concert.conInfoStatus,
        submittedAt: new Date().toISOString(),
      },
    });
  }
);

// ------------10. 獲得演唱會詳細資料-------------
export const getConcertById = handleErrorAsync(
  async (req: Request, res: Response) => {
    const { concertId } = req.params;

    // 驗證 concertId的UUID 格式
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(concertId)) {
      throw ApiError.invalidFormat('演唱會 ID 格式錯誤');
    }

    const concertRepository = AppDataSource.getRepository(Concert);
    const concert = await concertRepository.findOne({
      where: {
        concertId: concertId,
        cancelledAt: IsNull(),
      },
      relations: ['sessions', 'sessions.ticketTypes'],
    });
    if (!concert) {
      throw ApiError.notFound('演唱會不存在');
    }

    res.status(200).json({
      status: 'success',
      data: concert,
    });
  }
);

//------------11. 獲得 location tags -------------
export const getLocationTags = handleErrorAsync(
  async (req: Request, res: Response) => {
    const locationTagRepository = AppDataSource.getRepository(LocationTag);

    const locationTags = await locationTagRepository.find();

    if (!locationTags.length) {
      throw ApiError.notFound('地點標籤資料');
    }

    res.status(200).json({
      status: 'success',
      message: '成功取得地點標籤',
      data: locationTags,
    });
  }
);

//------------12. 獲得music tags-------------
export const getMusicTags = handleErrorAsync(
  async (req: Request, res: Response) => {
    const musicTagRepository = AppDataSource.getRepository(MusicTag);

    const musicTags = await musicTagRepository.find();

    if (!musicTags.length) {
      throw ApiError.notFound('音樂類型標籤資料');
    }

    res.status(200).json({
      status: 'success',
      message: '成功取得音樂標籤',
      data: musicTags,
    });
  }
);

// ------------13. 軟刪除演唱會-------------
export const softDeleteConcert = handleErrorAsync(
  async (req: Request, res: Response) => {
    const authenticatedUser = req.user as { userId: string };
    if (!authenticatedUser?.userId) {
      throw ApiError.unauthorized();
    }

    const concertId = req.params.concertId;
    console.log('要刪除的 concertId:', concertId);
    const concertRepository = AppDataSource.getRepository(Concert);

    const concert = await concertRepository.findOne({
      where: { concertId, cancelledAt: IsNull() },
      relations: ['organization'],
    });

    if (!concert) {
      throw ApiError.notFound('演唱會不存在');
    }

    // 檢查是否可以刪除
    if (!concert.canBeDeleted()) {
      throw ApiError.badRequest('只能刪除草稿、退回或審核中的演唱會');
    }

    // 軟刪除
    concert.softDelete();
    await concertRepository.save(concert);

    res.status(200).json({
      status: 'success',
      message: '演唱會已成功軟刪除',
      data: {
        concertId: concert.concertId,
        cancelledAt: concert.cancelledAt,
      },
    });
  }
);

// ------------14. 複製演唱會 -------------
export const duplicateConcert = handleErrorAsync(
  async (req: Request, res: Response) => {
    const { concertId } = req.params;
    const authenticatedUser = req.user as { userId: string };
    if (!authenticatedUser?.userId) throw ApiError.unauthorized();

    const concertRepo = AppDataSource.getRepository(Concert);
    const sessionRepo = AppDataSource.getRepository(ConcertSession);
    const ticketTypeRepo = AppDataSource.getRepository(TicketType);

    const originalConcert = await concertRepo.findOne({
      where: { concertId, cancelledAt: IsNull() },
      relations: ['sessions', 'sessions.ticketTypes'],
    });
    if (!originalConcert) throw ApiError.notFound('演唱會不存在');

    // 複製 concert 主資料
    const concertData: Partial<Concert> = {
      organizationId: originalConcert.organizationId,
      venueId: originalConcert.venueId,
      locationTagId: originalConcert.locationTagId,
      musicTagId: originalConcert.musicTagId,
      conTitle: `${originalConcert.conTitle} (複製)`,
      conIntroduction: originalConcert.conIntroduction,
      conLocation: originalConcert.conLocation,
      conAddress: originalConcert.conAddress,
      eventStartDate: originalConcert.eventStartDate,
      eventEndDate: originalConcert.eventEndDate,
      imgBanner: originalConcert.imgBanner,
      ticketPurchaseMethod: originalConcert.ticketPurchaseMethod,
      precautions: originalConcert.precautions,
      refundPolicy: originalConcert.refundPolicy,
      conInfoStatus: 'draft',
      visitCount: 0,
      promotion: 0,
      cancelledAt: null,
    };

    const duplicatedConcert = concertRepo.create(concertData);
    const savedConcert: Concert = await concertRepo.save(duplicatedConcert);

    // 複製 sessions 和 ticketTypes
    for (const originalSession of originalConcert.sessions) {
      const duplicatedSession = sessionRepo.create({
        concert: savedConcert,
        sessionTitle: originalSession.sessionTitle,
        sessionDate: originalSession.sessionDate,
        sessionStart: originalSession.sessionStart,
        sessionEnd: originalSession.sessionEnd,
        imgSeattable: originalSession.imgSeattable,
      });
      const savedSession = await sessionRepo.save(duplicatedSession);

      const duplicatedTickets = originalSession.ticketTypes.map((ticket) =>
        ticketTypeRepo.create({
          concertSession: savedSession,
          ticketTypeName: ticket.ticketTypeName,
          entranceType: ticket.entranceType,
          ticketBenefits: ticket.ticketBenefits,
          ticketRefundPolicy: ticket.ticketRefundPolicy,
          ticketTypePrice: ticket.ticketTypePrice,
          totalQuantity: ticket.totalQuantity,
          remainingQuantity: ticket.totalQuantity,
          sellBeginDate: ticket.sellBeginDate,
          sellEndDate: ticket.sellEndDate,
        })
      );

      await ticketTypeRepo.save(duplicatedTickets);
    }

    res.status(201).json({
      status: 'success',
      message: '演唱會複製成功，已儲存為草稿',
      data: {
        concertId: savedConcert.concertId,
        conTitle: savedConcert.conTitle,
        conInfoStatus: savedConcert.conInfoStatus,
      },
    });
  }
);

// ------------15. 檢查演唱會名字是否重複-------------
export const checkConcertTitleExists = handleErrorAsync(
  async (req: Request, res: Response) => {
    const { title } = req.query as { title: string };

    if (!title) {
      throw ApiError.fieldRequired('演唱會名稱');
    }

    const concertRepository = AppDataSource.getRepository(Concert);
    const existingConcert = await concertRepository.findOne({
      where: { conTitle: title, cancelledAt: IsNull() },
    });

    res.status(200).json({
      status: 'success',
      message: existingConcert ? '演唱會名稱已存在' : '演唱會名稱可用',
      data: { exists: !!existingConcert },
    });
  }
);
