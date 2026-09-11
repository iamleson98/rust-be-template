/**
 * Zod schema + form types for the FeedbackForm.
 *
 * Extracted from the original 'feedback-form.tsx' so the form
 * orchestrator and the extracted field components can share the
 * same validation contract.
 */

import { z } from 'zod'

/**
 * Zod schema for the review form.
 *   - rating 1-5 (required, must be > 0)
 *   - title ≤ 80 chars (optional)
 *   - content ≤ 2000 chars, ≥ 20 chars if non-empty (optional but recommended)
 *   - tags: optional array of strings
 *   - photos: optional array of data-URL/HTTP strings
 */
export const feedbackSchema = z.object({
  rating: z
    .number()
    .min(1, 'Vui lòng chọn số sao đánh giá')
    .max(5, 'Đánh giá tối đa 5 sao'),
  title: z.string().trim().max(255, 'Tiêu đề tối đa 255 ký tự'),
  content: z
    .string()
    .trim()
    .max(10000, 'Nhận xét quá dài')
    .refine(
      (val) => val.length === 0 || val.length >= 20,
      'Nội dung đánh giá cần ít nhất 20 ký tự để gửi',
    ),
  // Backend enforces max 20 tags + max 10 photos.
  tags: z.array(z.string()).max(20, 'Tối đa 20 thẻ'),
  photos: z.array(z.string()).max(10, 'Tối đa 10 ảnh'),
})

export type FeedbackValues = z.infer<typeof feedbackSchema>
