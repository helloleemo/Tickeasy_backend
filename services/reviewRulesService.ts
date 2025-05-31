/**
 * 審核規則配置服務
 * 
 * 職責：
 * - 定義和管理演唱會內容的審核標準和規則
 * - 提供可配置的審核參數，例如敏感詞列表、價格合理性範圍等
 * - 方便未來擴展和調整審核策略
 */

// 審核標準類型定義
export interface ReviewCriteria {
  checkInappropriateContent: boolean; // 檢查不當內容（色情、暴力、歧視等）
  checkFalseAdvertising: boolean;     // 檢查虛假或誇大宣傳
  checkPricingReasonableness: boolean; // 檢查價格是否在合理範圍
  checkInformationCompleteness: boolean; // 檢查資訊完整性（日期、地點、票價等）
  // 未來可擴展其他標準，例如：
  // checkCopyrightIssues: boolean;    // 檢查版權問題
  // checkEventFeasibility: boolean;   // 檢查活動可行性
}

// 價格合理性配置
export interface PricingConfig {
  minPrice: number; // 最低票價 (TWD)
  maxPrice: number; // 最高票價 (TWD)
  // 未來可擴展更複雜的價格檢查邏輯，例如：
  // pricePerDayLimit: number; // 單日活動票價上限
  // vipPriceRatioLimit: number; // VIP票價與普通票價比例上限
}

// 敏感詞配置
export interface SensitiveWordsConfig {
  defaultList: string[]; // 預設敏感詞列表
  // 未來可擴展：
  // customLists: Record<string, string[]>; // 自訂敏感詞列表（按類別）
  // allowRegex: boolean; // 是否允許使用正規表示法
}


// 預設審核標準
const DEFAULT_REVIEW_CRITERIA: ReviewCriteria = {
  checkInappropriateContent: true,
  checkFalseAdvertising: true,
  checkPricingReasonableness: true,
  checkInformationCompleteness: true,
};

// 預設價格配置 (以台灣市場為例)
const DEFAULT_PRICING_CONFIG: PricingConfig = {
  minPrice: 100,    // 假設最低票價為 100 元
  maxPrice: 15000,  // 假設最高票價為 15000 元 (考慮大型音樂節)
};

// 預設敏感詞列表 (範例，需根據實際需求擴充)
const DEFAULT_SENSITIVE_WORDS: SensitiveWordsConfig = {
  defaultList: [
    '賭博', '暴力', '色情', '歧視', '詐騙', '非法', 
    // 政治敏感 (需謹慎使用)
    // '獨立', '統一', 
    // 其他不當言論
    '白痴', '腦殘', '垃圾', 
  ],
};


export class ReviewRulesService {
  private criteria: ReviewCriteria;
  private pricing: PricingConfig;
  private sensitiveWords: SensitiveWordsConfig;

  constructor(
    criteria: Partial<ReviewCriteria> = {},
    pricing: Partial<PricingConfig> = {},
    sensitiveWords: Partial<SensitiveWordsConfig> = {}
  ) {
    this.criteria = { ...DEFAULT_REVIEW_CRITERIA, ...criteria };
    this.pricing = { ...DEFAULT_PRICING_CONFIG, ...pricing };
    this.sensitiveWords = {
      defaultList: [
        ...(DEFAULT_SENSITIVE_WORDS.defaultList || []),
        ...(sensitiveWords.defaultList || []),
      ],
    };
  }

  /**
   * 取得當前審核標準
   */
  getReviewCriteria(): ReviewCriteria {
    return { ...this.criteria };
  }

  /**
   * 更新審核標準
   */
  updateReviewCriteria(newCriteria: Partial<ReviewCriteria>): void {
    this.criteria = { ...this.criteria, ...newCriteria };
  }

  /**
   * 取得價格配置
   */
  getPricingConfig(): PricingConfig {
    return { ...this.pricing };
  }

  /**
   * 取得敏感詞列表
   */
  getSensitiveWords(): string[] {
    return [...this.sensitiveWords.defaultList];
  }

  /**
   * 檢查文字是否包含敏感詞
   * @param text 要檢查的文字
   * @returns 如果包含敏感詞則返回第一個匹配到的敏感詞，否則返回 null
   */
  checkSensitiveWords(text: string): string | null {
    if (!text) return null;
    for (const word of this.sensitiveWords.defaultList) {
      if (text.toLowerCase().includes(word.toLowerCase())) {
        return word;
      }
    }
    return null;
  }

  /**
   * 檢查價格是否在合理範圍內
   * @param price 要檢查的價格
   * @returns 如果價格合理則返回 true，否則返回 false
   */
  isPriceReasonable(price: number): boolean {
    return price >= this.pricing.minPrice && price <= this.pricing.maxPrice;
  }
}

// 導出單例
export default new ReviewRulesService(); 