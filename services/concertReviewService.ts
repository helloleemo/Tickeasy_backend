import { AppDataSource } from '../config/database.js';
import { Concert } from '../models/concert.js';
import { ConcertReview, ReviewType } from '../models/concert-review.js';
import openAIService, { AIReviewResponse } from './openaiService.js';
import { ReviewStatus } from '../models/concert.js'; // Assuming ReviewStatus is exported from concert.ts
import { ApiError } from '../utils/index.js';
import { DeepPartial } from 'typeorm';

/**
 * 服務：演唱會審核業務邏輯
 *
 * 職責：
 * 1. 接收演唱會 ID，觸發 AI 自動審核流程。
 * 2. 從資料庫獲取演唱會完整資料。
 * 3. 調用 OpenAIService 進行內容審核。
 * 4. 將 AI 審核的詳細結果保存到 concertReview 表。
 * 5. 根據 AI 審核結果，更新 concert 表的 reviewStatus 和 (如果適用) conInfoStatus。
 * 6. 提供手動審核的接口方法。
 * 7. 記錄手動審核結果。
 * 8. 處理審核過程中的錯誤和例外情況。
 */
export class ConcertReviewService {
  private concertRepository = AppDataSource.getRepository(Concert);
  private concertReviewRepository = AppDataSource.getRepository(ConcertReview);

  constructor() {
    // 可在此處注入依賴，例如 Logger
  }

  /**
   * 觸發對指定演唱會的 AI 自動審核。
   * @param concertId 演唱會 ID
   * @returns Promise<ConcertReview> 創建的 AI 審核記錄
   * @throws ApiError 如果演唱會不存在或無法審核
   */
  async triggerAIReview(concertId: string): Promise<ConcertReview> {
    const concert = await this.findConcertForReview(concertId);

    // 檢查演唱會是否適合進行 AI 審核 (例如，狀態是否為 reviewing)
    // 這裡可以根據具體業務邏輯添加更多檢查
    if (concert.conInfoStatus !== 'reviewing') {
      throw ApiError.badRequest(
        `演唱會 ${concertId} 狀態為 ${concert.conInfoStatus}，無法觸發 AI 審核。`,
      );
    }

    // 檢查是否已有正在進行中的 AI 審核
    const existingPendingAIReview = await this.concertReviewRepository.findOne({
      where: {
        concertId,
        reviewType: 'ai_auto',
        reviewStatus: ReviewStatus.PENDING,
      },
    });

    if (existingPendingAIReview) {
      console.log(`演唱會 ${concertId} 已有待處理的 AI 審核記錄 ${existingPendingAIReview.reviewId}，將直接使用該記錄。`);
      // 可選擇返回現有記錄或重新執行，這裡先假設不重複執行
      // 如果 AI 審核失敗或超時，可能需要不同的處理邏輯
      // return existingPendingAIReview; 
      // 或者，如果希望強制重新審核，則可以先將舊的標記為SKIPPED或ERROR等
    }
    
    console.log(`正在為演唱會 ${concertId} 觸發 AI 審核...`);
    const aiResponse = await openAIService.reviewConcert(concert);
    console.log(`AI 審核完成，演唱會 ${concertId}，結果：`, aiResponse.approved ? '通過' : '未通過/需人工');

    const reviewData: DeepPartial<ConcertReview> = {
      concertId,
      reviewType: 'ai_auto' as ReviewType,
      reviewStatus: this.mapAIResponseToReviewStatus(aiResponse),
      aiResponse: aiResponse,
      reviewNote: aiResponse.summary || 'AI 未提供總結', // AI 的總結作為 reviewNote
    };

    const newReview = this.concertReviewRepository.create(reviewData);
    await this.concertReviewRepository.save(newReview);
    console.log(`AI 審核記錄 ${newReview.reviewId} 已為演唱會 ${concertId} 保存。`);

    // 更新 Concert 主表的狀態
    await this.updateConcertStatusAfterReview(concert, newReview, aiResponse);

    return newReview;
  }

  /**
   * 處理手動審核提交。
   * @param concertId 演唱會 ID
   * @param reviewerId 審核員 ID
   * @param reviewStatus 手動審核結果 (approved, rejected)
   * @param reviewerNote 手動審核備註
   * @param reviewType 手動審核類型 ('manual_admin' 或 'manual_system')
   * @returns Promise<ConcertReview> 創建的手動審核記錄
   */
  async submitManualReview(
    concertId: string,
    reviewerId: string,
    reviewStatus: ReviewStatus.APPROVED | ReviewStatus.REJECTED, // 限制手動審核的結果
    reviewerNote: string,
    reviewType: 'manual_admin' | 'manual_system' = 'manual_admin',
  ): Promise<ConcertReview> {
    const concert = await this.findConcertForReview(concertId);

    if (reviewStatus !== ReviewStatus.APPROVED && reviewStatus !== ReviewStatus.REJECTED) {
        throw ApiError.badRequest('無效的手動審核狀態，必須是 approved 或 rejected。');
    }

    const reviewData: DeepPartial<ConcertReview> = {
      concertId,
      reviewType: reviewType as ReviewType,
      reviewStatus,
      reviewerId,
      reviewerNote,
      reviewNote: reviewerNote, // 手動審核時，reviewerNote 也作為主要的 reviewNote
    };

    const newReview = this.concertReviewRepository.create(reviewData);
    await this.concertReviewRepository.save(newReview);
    console.log(`手動審核記錄 ${newReview.reviewId} 已為演唱會 ${concertId} 保存。`);

    // 更新 Concert 主表的狀態
    await this.updateConcertStatusAfterReview(concert, newReview);

    return newReview;
  }

  /**
   * 輔助方法：根據 AI 回應決定 ConcertReview 的狀態
   */
  private mapAIResponseToReviewStatus(aiResponse: AIReviewResponse): ReviewStatus {
    if (aiResponse.error) return ReviewStatus.SKIPPED; // AI 審核過程出錯，標記為 SKIPPED，需要人工介入
    if (aiResponse.requiresManualReview) return ReviewStatus.PENDING; // AI 建議人工審核，則整體還是 PENDING
    if (aiResponse.approved) return ReviewStatus.APPROVED;
    return ReviewStatus.REJECTED; // 其他情況（例如 approved: false 且 requiresManualReview: false）
  }

  /**
   * 輔助方法：審核後更新演唱會主表的狀態
   * @param concert 演唱會實體
   * @param reviewRecord 相關的審核記錄 (AI或手動)
   * @param aiResponse 可選的 AI 回應，用於 AI 審核時的特殊邏輯
   */
  private async updateConcertStatusAfterReview(
    concert: Concert,
    reviewRecord: ConcertReview,
    aiResponse?: AIReviewResponse,
  ): Promise<void> {
    let mainReviewStatus = reviewRecord.reviewStatus;
    let mainReviewNote = reviewRecord.reviewNote || '';

    // 如果是 AI 審核，且 AI 建議人工介入
    if (aiResponse && aiResponse.requiresManualReview && reviewRecord.reviewType === 'ai_auto') {
      mainReviewStatus = ReviewStatus.PENDING; // 維持 PENDING，等待人工審核
      mainReviewNote = `AI 審核建議人工介入: ${aiResponse.summary || '無詳細說明'}. ${mainReviewNote}`;
      concert.reviewStatus = mainReviewStatus;
      concert.reviewNote = mainReviewNote;
      // 注意：conInfoStatus 此時不應改變，仍為 reviewing
    } else {
      // 對於 AI 審核通過/拒絕，或手動審核
      concert.reviewStatus = mainReviewStatus;
      concert.reviewNote = mainReviewNote;

      if (mainReviewStatus === ReviewStatus.APPROVED) {
        concert.conInfoStatus = 'published'; // 審核通過，發布
        console.log(`演唱會 ${concert.concertId} 已審核通過並發布。`);
      } else if (mainReviewStatus === ReviewStatus.REJECTED) {
        concert.conInfoStatus = 'rejected'; // 審核拒絕
        console.log(`演唱會 ${concert.concertId} 已被拒絕。`);
      }
      // SKIPPED 狀態下，conInfoStatus 保持 reviewing，reviewStatus 標為 skipped
       else if (mainReviewStatus === ReviewStatus.SKIPPED) {
        concert.conInfoStatus = 'reviewing'; // 保持 reviewing
        console.log(`演唱會 ${concert.concertId} AI審核跳過，狀態維持 reviewing，需要人工介入。`);
      }
    }
    
    await this.concertRepository.save(concert);
    console.log(`演唱會 ${concert.concertId} 主表狀態已更新。reviewStatus: ${concert.reviewStatus}, conInfoStatus: ${concert.conInfoStatus}`);
  }

  /**
   * 輔助方法：查找用於審核的演唱會，並檢查基本條件
   */
  private async findConcertForReview(concertId: string): Promise<Concert> {
    const concert = await this.concertRepository.findOne({
      where: { concertId },
      relations: ['sessions', 'sessions.ticketTypes'], // 載入審核可能需要的關聯資料
    });

    if (!concert) {
      throw ApiError.notFound(`演唱會 ${concertId} 不存在`);
    }
    return concert;
  }

  /**
   * 獲取指定演唱會的所有審核記錄
   * @param concertId 演唱會 ID
   */
  async getConcertReviews(concertId: string): Promise<ConcertReview[]> {
    return this.concertReviewRepository.find({
      where: { concertId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 獲取最新的審核記錄 (不論類型)
   * @param concertId 演唱會 ID
   */
  async getLatestReview(concertId: string): Promise<ConcertReview | null> {
    return this.concertReviewRepository.findOne({
      where: { concertId },
      order: { createdAt: 'DESC' },
    });
  }
}

// 導出單例模式
export default new ConcertReviewService(); 