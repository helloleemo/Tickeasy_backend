/**
 * 演唱會審核記錄模型
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Concert, ReviewStatus } from './concert.js';

export type ReviewType = 'ai_auto' | 'manual_admin' | 'manual_system';

@Entity('concertReview')
export class ConcertReview {
  @PrimaryGeneratedColumn('uuid', { name: 'reviewId' })
  reviewId: string;

  @Column({ name: 'concertId', type: 'uuid', nullable: false })
  concertId: string;

  @ManyToOne(() => Concert, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'concertId' })
  concert: Concert;

  @Column({ type: 'varchar', length: 20, nullable: false })
  reviewType: ReviewType; // 'ai_auto', 'manual_admin', 'manual_system'

  @Column({
    type: 'enum',
    enum: "ReviewStatus",
    default: 'pending',
    nullable: false,
  })
  reviewStatus: ReviewStatus;

  @Column({ type: 'text', nullable: true })
  reviewNote: string; // 詳細審核說明

  // AI 審核專用欄位
  @Column({ type: 'jsonb', nullable: true })
  aiResponse: {
    model: string;
    confidence: number;
    reasons: string[];
    suggestions?: string[];
    flaggedContent?: string[];
    summary: string;
    requiresManualReview: boolean;
    rawResponse?: any;
  } | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reviewerId: string; // 手動審核者 ID（AI 審核時為 null）

  @Column({ type: 'text', nullable: true })
  reviewerNote: string; // 審核者補充備註

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * 檢查是否為 AI 審核
   */
  public isAIReview(): boolean {
    return this.reviewType === 'ai_auto';
  }

  /**
   * 檢查是否需要人工審核
   */
  public requiresManualReview(): boolean {
    return this.aiResponse?.requiresManualReview === true;
  }

  /**
   * 取得審核信心度（僅 AI 審核有效）
   */
  public getConfidence(): number | null {
    return this.aiResponse?.confidence ?? null;
  }

  /**
   * 檢查審核是否通過
   */
  public isApproved(): boolean {
    return this.reviewStatus === ReviewStatus.APPROVED;
  }

  /**
   * 檢查審核是否被拒絕
   */
  public isRejected(): boolean {
    return this.reviewStatus === ReviewStatus.REJECTED;
  }

  /**
   * 檢查審核是否待處理
   */
  public isPending(): boolean {
    return this.reviewStatus === ReviewStatus.PENDING;
  }
} 