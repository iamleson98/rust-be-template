import type { Lang } from '@/lib/i18n'
import type { LegalDoc } from './legal-page'

/** The terms of use. Keep it in line with how booking actually works. */
export const termsOfUse: Record<Lang, LegalDoc> = {
  vi: {
    title: 'Điều khoản sử dụng',
    updated: '10/10/2026',
    intro: [
      'Các điều khoản này áp dụng khi bạn dùng website và ứng dụng DatXeVui (datxevui.com). Khi tạo tài khoản hoặc đặt vé, bạn đồng ý với các điều khoản này và Chính sách bảo mật của chúng tôi.',
    ],
    sections: [
      {
        id: 'service',
        heading: 'Dịch vụ của DatXeVui',
        body: [
          'DatXeVui là nền tảng trung gian giúp bạn tìm chuyến, chọn ghế và đặt vé với các nhà xe. Việc vận chuyển do nhà xe thực hiện và chịu trách nhiệm; giờ chạy, xe, tiện nghi và điểm đón/trả theo thông tin nhà xe cung cấp.',
        ],
      },
      {
        id: 'account',
        heading: 'Tài khoản',
        body: [
          {
            list: [
              'Bạn cần từ 16 tuổi trở lên để tạo tài khoản.',
              'Cung cấp thông tin chính xác và cập nhật; giữ bí mật mật khẩu và chịu trách nhiệm về hoạt động trên tài khoản của mình.',
              'Bạn có thể đăng nhập bằng Google hoặc Facebook; khi đó tài khoản DatXeVui được liên kết với tài khoản đó.',
            ],
          },
        ],
      },
      {
        id: 'booking-payment',
        heading: 'Đặt vé và thanh toán',
        body: [
          {
            list: [
              'Ghế được giữ trong thời gian có hạn để bạn hoàn tất đặt vé; hết thời gian, ghế được trả lại cho người khác.',
              'Vé thanh toán khi lên xe được nhà xe gọi điện xác nhận theo số điện thoại bạn cung cấp.',
              'Vé thanh toán trực tuyến được xác nhận khi cổng thanh toán báo giao dịch thành công.',
              'Giá vé hiển thị khi đặt là giá bạn trả, đã gồm các khoản giảm giá được áp dụng.',
              'Bạn chịu trách nhiệm về tính chính xác của thông tin hành khách và người liên hệ.',
            ],
          },
        ],
      },
      {
        id: 'cancellation',
        heading: 'Huỷ vé và hoàn tiền',
        body: [
          'Việc huỷ, đổi vé và hoàn tiền theo chính sách của nhà xe, hiển thị ở mục “Chính sách” của từng chuyến trước khi bạn đặt. Tiền hoàn (nếu có) được trả về phương thức bạn đã thanh toán.',
        ],
      },
      {
        id: 'conduct',
        heading: 'Trách nhiệm của bạn',
        body: [
          {
            list: [
              'Không đặt vé giả, không dùng phương thức thanh toán không thuộc quyền của bạn, không phá hoại hay truy cập trái phép hệ thống.',
              'Cư xử lịch sự với nhân viên hỗ trợ và nhà xe.',
              'Đánh giá trung thực, dựa trên chuyến đi thật; không đăng nội dung vi phạm pháp luật, xúc phạm hay quảng cáo.',
            ],
          },
          'Chúng tôi có thể tạm khoá hoặc chấm dứt tài khoản vi phạm các điều khoản này.',
        ],
      },
      {
        id: 'reviews',
        heading: 'Đánh giá và nội dung bạn gửi',
        body: [
          'Đánh giá được kiểm duyệt trước khi hiển thị. Khi gửi đánh giá, bạn cho phép DatXeVui hiển thị nội dung đó trên website; chúng tôi có thể ẩn nội dung vi phạm các điều khoản này.',
        ],
      },
      {
        id: 'liability',
        heading: 'Giới hạn trách nhiệm',
        body: [
          'Chúng tôi cố gắng để thông tin chuyến đi chính xác và dịch vụ hoạt động liên tục, nhưng không chịu trách nhiệm về việc nhà xe thay đổi lịch, chậm trễ hay sự cố trong quá trình vận chuyển. Mọi khiếu nại về chuyến đi, chúng tôi sẽ hỗ trợ bạn làm việc với nhà xe.',
        ],
      },
      {
        id: 'changes-law',
        heading: 'Thay đổi, luật áp dụng và liên hệ',
        body: [
          'Khi điều khoản thay đổi, chúng tôi cập nhật ngày hiệu lực ở đầu trang. Các điều khoản này được điều chỉnh bởi pháp luật Việt Nam.',
          'Liên hệ: cskh@datxevui.com hoặc tổng đài 1900 6067.',
        ],
      },
    ],
  },
  en: {
    title: 'Terms of use',
    updated: '10 October 2026',
    intro: [
      'These terms apply when you use the DatXeVui website and app (datxevui.com). By creating an account or booking a ticket, you agree to these terms and to our Privacy policy.',
    ],
    sections: [
      {
        id: 'service',
        heading: 'The DatXeVui service',
        body: [
          'DatXeVui is an intermediary platform that helps you find trips, pick seats and book tickets with bus operators. Transport is provided by, and is the responsibility of, the operator; schedules, vehicles, amenities and pick-up/drop-off points follow the operator’s information.',
        ],
      },
      {
        id: 'account',
        heading: 'Your account',
        body: [
          {
            list: [
              'You must be 16 or older to create an account.',
              'Give accurate, up-to-date information; keep your password secret; you are responsible for activity on your account.',
              'You can sign in with Google or Facebook; your DatXeVui account is then linked to that account.',
            ],
          },
        ],
      },
      {
        id: 'booking-payment',
        heading: 'Booking and payment',
        body: [
          {
            list: [
              'Seats are held for a limited time while you complete the booking; after that they are released to others.',
              'Pay-on-board tickets are confirmed by the operator calling the phone number you give.',
              'Online-paid tickets are confirmed when the payment gateway reports a successful transaction.',
              'The price shown when you book is the price you pay, including any discount applied.',
              'You are responsible for the accuracy of passenger and contact details.',
            ],
          },
        ],
      },
      {
        id: 'cancellation',
        heading: 'Cancellations and refunds',
        body: [
          'Cancellations, changes and refunds follow the operator’s policy, shown under “Policies” on each trip before you book. Refunds, where due, go back to the method you paid with.',
        ],
      },
      {
        id: 'conduct',
        heading: 'Your responsibilities',
        body: [
          {
            list: [
              'Do not make fake bookings, use payment methods that are not yours, or disrupt or access the system without permission.',
              'Treat support staff and operators with courtesy.',
              'Review honestly, based on a real trip; do not post unlawful, abusive or promotional content.',
            ],
          },
          'We may suspend or close accounts that break these terms.',
        ],
      },
      {
        id: 'reviews',
        heading: 'Reviews and content you submit',
        body: [
          'Reviews are moderated before they appear. By submitting a review you allow DatXeVui to show it on the website; we may hide content that breaks these terms.',
        ],
      },
      {
        id: 'liability',
        heading: 'Limitation of liability',
        body: [
          'We work to keep trip information accurate and the service running, but we are not responsible for operators changing schedules, delays or incidents during transport. For any complaint about a trip, we will help you take it up with the operator.',
        ],
      },
      {
        id: 'changes-law',
        heading: 'Changes, governing law and contact',
        body: [
          'When these terms change we update the date at the top. These terms are governed by the laws of Vietnam.',
          'Contact: cskh@datxevui.com or hotline 1900 6067.',
        ],
      },
    ],
  },
}
