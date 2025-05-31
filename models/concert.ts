/**
 * 音樂會模型
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Organization } from './organization.js';
import { Venue } from './venue.js';
import { LocationTag } from './location-tag.js';
import { MusicTag } from './music-tag.js';
import { ConcertSession } from './concert-session.js';
import { ConcertReview } from './concert-review.js';
// import { TicketType } from './ticket-type.js';

export type ConInfoStatus = 'draft' | 'reviewing' | 'published' | 'rejected' | 'finished';

/* eslint-disable no-unused-vars */
export enum ReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SKIPPED = 'skipped',
}

@Entity('concert')
export class Concert {
  @PrimaryGeneratedColumn('uuid', { name: 'concertId' })
  concertId: string;

  @Column({ name: 'organizationId', type: 'uuid', nullable: false })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ name: 'venueId', type: 'uuid', nullable: true })
  venueId: string;

  @ManyToOne(() => Venue, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'venueId' })
  venue: Venue;

  @Column({ name: 'locationTagId', type: 'uuid', nullable: true })
  locationTagId: string;

  @ManyToOne(() => LocationTag, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'locationTagId' })
  locationTag: LocationTag;

  @Column({ name: 'musicTagId', type: 'uuid', nullable: true })
  musicTagId: string;

  @ManyToOne(() => MusicTag, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'musicTagId' })
  musicTag: MusicTag;

  @Column({ type: 'varchar', length: 50, nullable: false })
  conTitle: string;

  @Column({ type: 'varchar', length: 3000, nullable: true })
  conIntroduction: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  conLocation: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  conAddress: string;

  @Column({ type: 'date', nullable: true })
  eventStartDate: Date | null;

  @Column({ type: 'date', nullable: true })
  eventEndDate: Date | null; // yyyy-mm-dd

  @Column({ type: 'varchar', length: 255, nullable: true })
  imgBanner: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  ticketPurchaseMethod: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  precautions: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  refundPolicy: string;

  @Column({
    type: 'enum',
    enum: ['draft', 'reviewing', 'published', 'rejected', 'finished'] as ConInfoStatus[],
    default: 'draft',
    nullable: false,
  })
  conInfoStatus: ConInfoStatus;

  @Column({
    type: 'enum',
    enum: ReviewStatus,
    default: ReviewStatus.SKIPPED,
  })
  reviewStatus: ReviewStatus;

  @Column({ type: 'text', nullable: true })
  reviewNote: string; // 審核備註：記錄審核通過或退回的理由

  @Column({ type: 'int', default: 0 })
  visitCount: number; // 參觀人數

  @Column({ type: 'int', nullable: true })
  promotion: number; // 權重數字

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => ConcertSession, (session) => session.concert, {
    cascade: true, // 建立 Concert 時自動建立 sessions
    onDelete: 'CASCADE', // 刪除會連動刪除
    eager: true, // 取資料時會自動帶入
  })
  sessions: ConcertSession[];

  @OneToMany(() => ConcertReview, (review) => review.concert, {
    cascade: false, // 不自動建立審核記錄
    onDelete: 'CASCADE', // 刪除 Concert 時連動刪除 reviews
  })
  reviews: ConcertReview[];

  // @OneToMany(() => TicketType, ticketType => ticketType.concert)
  // ticketTypes: TicketType[];

  // 軟刪除相關方法
  /**
   * 檢查演唱會是否已被軟刪除
   */
  public isDeleted(): boolean {
    return this.cancelledAt !== null && this.cancelledAt !== undefined;
  }

  /**
   * 軟刪除演唱會
   */
  public softDelete(): void {
    this.cancelledAt = new Date();
  }

  /**
   * 恢復演唱會（取消軟刪除）
   */
  public restore(): void {
    this.cancelledAt = null;
  }

  /**
   * 檢查演唱會是否可以被刪除
   * 只有 draft、rejected、reviewing 狀態的演唱會可以被刪除
   */
  public canBeDeleted(): boolean {
    return ['draft', 'rejected', 'reviewing'].includes(this.conInfoStatus);
  }

  /**
   * 取得最新審核記錄
   */
  public getLatestReview(): ConcertReview | undefined {
    return this.reviews?.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }

  /**
   * 檢查是否有待審核狀態
   */
  public isPendingReview(): boolean {
    return this.conInfoStatus === 'reviewing';
  }

  /**
   * 檢查是否需要AI審核
   */
  public needsAIReview(): boolean {
    return this.conInfoStatus === 'reviewing' && this.reviewStatus === ReviewStatus.PENDING;
  }

  /**
   * 取得所有 AI 審核記錄
   */
  public getAIReviews(): ConcertReview[] {
    return this.reviews?.filter(review => review.isAIReview()) || [];
  }

  /**
   * 取得最新的 AI 審核記錄
   */
  public getLatestAIReview(): ConcertReview | undefined {
    const aiReviews = this.getAIReviews();
    return aiReviews.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }
}
