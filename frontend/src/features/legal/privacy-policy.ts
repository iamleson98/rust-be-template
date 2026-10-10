import type { Lang } from '@/lib/i18n'
import type { LegalDoc } from './legal-page'

/**
 * The privacy policy. It must describe what the code actually does —
 * update it with any change to what is collected, kept or shared.
 * `#data-deletion` is the deletion-instructions URL given to Meta.
 */
export const privacyPolicy: Record<Lang, LegalDoc> = {
  vi: {
    title: 'Chính sách bảo mật',
    updated: '10/10/2026',
    intro: [
      'DatXeVui (datxevui.com) là nền tảng đặt vé xe khách trực tuyến. Chính sách này cho biết chúng tôi thu thập dữ liệu cá nhân nào, dùng để làm gì, chia sẻ với ai và bạn có những quyền gì, theo Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân.',
      'Khi tạo tài khoản, đăng nhập hoặc đặt vé, bạn đồng ý cho chúng tôi xử lý dữ liệu theo chính sách này.',
    ],
    sections: [
      {
        id: 'data-we-collect',
        heading: 'Dữ liệu chúng tôi thu thập',
        body: [
          {
            list: [
              'Tài khoản: họ tên, email và/hoặc số điện thoại, mật khẩu (chỉ lưu dạng băm một chiều, không ai đọc được).',
              'Đăng nhập bằng Google hoặc Facebook: tên, email (nếu nhà cung cấp cho phép), ảnh đại diện và mã tài khoản tại nhà cung cấp đó. Chúng tôi không bao giờ nhận mật khẩu của các tài khoản này.',
              'Đặt vé: họ tên, tuổi và giới tính của hành khách; họ tên, số điện thoại và email người liên hệ; chuyến, ghế, điểm đón/trả, lịch sử vé và điểm thưởng.',
              'Thanh toán: phương thức, số tiền, mã và trạng thái giao dịch. Thông tin thẻ, ví và tài khoản ngân hàng do MoMo, VNPay, ZaloPay hoặc ngân hàng xử lý — chúng tôi không nhận và không lưu.',
              'Hỗ trợ: nội dung tin nhắn trò chuyện với chúng tôi. Cuộc gọi hỗ trợ qua internet được kết nối trực tiếp giữa hai bên và không được ghi âm.',
              'Đánh giá: số sao, nhận xét, thẻ đánh giá và ảnh bạn gửi.',
              'Kỹ thuật: địa chỉ IP, loại trình duyệt và thiết bị, cookie; mã thiết bị để gửi thông báo nếu bạn cho phép; vị trí của bạn chỉ khi bạn bấm “Vị trí của tôi” để tìm điểm đón gần nhất.',
            ],
          },
        ],
      },
      {
        id: 'how-we-use-it',
        heading: 'Chúng tôi dùng dữ liệu để làm gì',
        body: [
          {
            list: [
              'Giữ chỗ, xuất vé và quản lý chuyến đi của bạn; nhà xe gọi điện xác nhận vé thanh toán khi lên xe.',
              'Xử lý thanh toán, hoàn tiền và điểm thưởng.',
              'Trả lời yêu cầu hỗ trợ qua chat và cuộc gọi.',
              'Bảo vệ tài khoản và hệ thống: chống gian lận, giới hạn truy cập bất thường; cuộc gọi hỗ trợ chỉ nhận từ mạng tại Việt Nam.',
              'Đo lường và cải thiện dịch vụ, hiệu quả quảng cáo (khi Google Analytics/Google Ads được bật).',
            ],
          },
          'Chúng tôi không bán dữ liệu cá nhân của bạn.',
        ],
      },
      {
        id: 'sharing',
        heading: 'Chia sẻ dữ liệu',
        body: [
          'Chúng tôi chỉ chia sẻ dữ liệu khi cần để cung cấp dịch vụ:',
          {
            list: [
              'Nhà xe bạn đặt vé: thông tin hành khách và người liên hệ để phục vụ chuyến đi.',
              'Cổng thanh toán (MoMo, VNPay, ZaloPay, ngân hàng): số tiền và mã giao dịch.',
              'Google, Facebook: khi bạn chọn đăng nhập bằng tài khoản của họ.',
              'Nhà cung cấp hạ tầng: máy chủ, mạng phân phối Cloudflare, Firebase (gửi thông báo).',
              'Trợ lý tự động: khi không có nhân viên trực, tin nhắn chat có thể được trợ lý tự động xử lý để trả lời.',
              'Google Analytics/Google Ads (nếu được bật): dữ liệu sử dụng và mã nhấp quảng cáo — không gồm tên, email hay số điện thoại.',
              'Cơ quan nhà nước có thẩm quyền khi pháp luật yêu cầu.',
            ],
          },
        ],
      },
      {
        id: 'cookies',
        heading: 'Cookie',
        body: [
          {
            list: [
              'Cookie đăng nhập (bắt buộc): giữ bạn đăng nhập một cách an toàn.',
              'Bộ nhớ trình duyệt: lưu lựa chọn như ngôn ngữ và tìm kiếm gần đây ngay trên máy bạn.',
              'Cookie phân tích và quảng cáo của Google: chỉ khi được bật trên website.',
            ],
          },
          'Bạn có thể xoá cookie trong cài đặt trình duyệt; khi đó bạn sẽ cần đăng nhập lại.',
        ],
      },
      {
        id: 'storage-security',
        heading: 'Lưu trữ và bảo mật',
        body: [
          'Dữ liệu được truyền qua kết nối mã hoá HTTPS. Mật khẩu chỉ lưu dạng băm. Nhân viên chỉ truy cập dữ liệu cần cho công việc của mình.',
          'Chúng tôi lưu dữ liệu trong thời gian tài khoản còn hoạt động. Hồ sơ giao dịch có thể được giữ lâu hơn khi pháp luật về kế toán và thuế yêu cầu.',
        ],
      },
      {
        id: 'your-rights',
        heading: 'Quyền của bạn',
        body: [
          'Theo Nghị định 13/2023/NĐ-CP, bạn có quyền được biết, đồng ý hoặc rút lại sự đồng ý, truy cập, chỉnh sửa, yêu cầu xoá, hạn chế hoặc phản đối việc xử lý dữ liệu của mình, và khiếu nại. Để thực hiện các quyền này, hãy liên hệ chúng tôi theo mục Liên hệ bên dưới.',
        ],
      },
      {
        id: 'data-deletion',
        heading: 'Xoá tài khoản và dữ liệu',
        body: [
          'Để xoá tài khoản và dữ liệu cá nhân của bạn:',
          {
            list: [
              'Gửi email tới cskh@datxevui.com từ email của tài khoản (hoặc nhắn qua mục Hỗ trợ khi đang đăng nhập), tiêu đề “Yêu cầu xoá tài khoản”.',
              'Chúng tôi xác minh bạn là chủ tài khoản rồi xoá tài khoản cùng dữ liệu cá nhân, và báo cho bạn khi hoàn tất.',
              'Nếu bạn đăng nhập bằng Google hoặc Facebook, bạn cũng có thể gỡ quyền của DatXeVui trong phần cài đặt bảo mật của tài khoản đó; việc này dừng đăng nhập, còn dữ liệu đã lưu sẽ được xoá khi bạn gửi yêu cầu như trên.',
            ],
          },
          'Hồ sơ giao dịch pháp luật bắt buộc lưu giữ sẽ được giữ ở mức tối thiểu và không còn gắn với tài khoản của bạn.',
        ],
      },
      {
        id: 'children',
        heading: 'Trẻ em',
        body: [
          'Tài khoản dành cho người từ 16 tuổi. Thông tin hành khách là trẻ em do người lớn đặt vé cung cấp, và chỉ được dùng cho chuyến đi đó.',
        ],
      },
      {
        id: 'changes-contact',
        heading: 'Thay đổi và liên hệ',
        body: [
          'Khi chính sách thay đổi, chúng tôi cập nhật ngày hiệu lực ở đầu trang và thông báo trên website với các thay đổi quan trọng.',
          'Mọi câu hỏi về dữ liệu cá nhân: cskh@datxevui.com hoặc tổng đài 1900 6067.',
        ],
      },
    ],
  },
  en: {
    title: 'Privacy policy',
    updated: '10 October 2026',
    intro: [
      'DatXeVui (datxevui.com) is an online coach-ticket booking platform. This policy explains what personal data we collect, what we use it for, who we share it with and what your rights are, under Vietnam’s Decree 13/2023/ND-CP on personal data protection.',
      'By creating an account, signing in or booking, you agree to us processing your data as described here.',
    ],
    sections: [
      {
        id: 'data-we-collect',
        heading: 'Data we collect',
        body: [
          {
            list: [
              'Account: name, email and/or phone number, password (stored only as a one-way hash that nobody can read).',
              'Sign-in with Google or Facebook: name, email (where the provider allows), profile picture and your account id at that provider. We never receive the password of those accounts.',
              'Bookings: passengers’ names, ages and genders; the contact person’s name, phone and email; trip, seats, pick-up and drop-off points, ticket history and loyalty points.',
              'Payments: method, amount, transaction reference and status. Card, wallet and bank details are handled by MoMo, VNPay, ZaloPay or your bank — we neither receive nor store them.',
              'Support: the messages you exchange with us in chat. Support calls over the internet connect the two sides directly and are not recorded.',
              'Reviews: the stars, comments, tags and photos you submit.',
              'Technical: IP address, browser and device type, cookies; a device token for notifications if you allow them; your location only when you tap “My location” to find the nearest pick-up point.',
            ],
          },
        ],
      },
      {
        id: 'how-we-use-it',
        heading: 'How we use it',
        body: [
          {
            list: [
              'Holding seats, issuing tickets and managing your trips; operators phone you to confirm pay-on-board tickets.',
              'Processing payments, refunds and loyalty points.',
              'Answering support requests by chat and call.',
              'Protecting accounts and the service: preventing fraud and unusual traffic; support calls are accepted only from networks in Vietnam.',
              'Measuring and improving the service and advertising (when Google Analytics/Google Ads are enabled).',
            ],
          },
          'We do not sell your personal data.',
        ],
      },
      {
        id: 'sharing',
        heading: 'Sharing',
        body: [
          'We share data only as needed to provide the service:',
          {
            list: [
              'The bus operator you book with: passenger and contact details to run your trip.',
              'Payment gateways (MoMo, VNPay, ZaloPay, banks): amount and transaction reference.',
              'Google, Facebook: when you choose to sign in with their account.',
              'Infrastructure providers: servers, Cloudflare’s delivery network, Firebase (notifications).',
              'Automated assistant: when no staff member is available, chat messages may be processed by an automated assistant to reply.',
              'Google Analytics/Google Ads (if enabled): usage data and ad click ids — not your name, email or phone number.',
              'Competent authorities when the law requires it.',
            ],
          },
        ],
      },
      {
        id: 'cookies',
        heading: 'Cookies',
        body: [
          {
            list: [
              'Sign-in cookies (required): keep you signed in securely.',
              'Browser storage: remembers choices such as language and recent searches on your device.',
              'Google analytics and advertising cookies: only when enabled on the website.',
            ],
          },
          'You can clear cookies in your browser settings; you will then need to sign in again.',
        ],
      },
      {
        id: 'storage-security',
        heading: 'Storage and security',
        body: [
          'Data travels over encrypted HTTPS connections. Passwords are stored only as hashes. Staff can access only the data their work needs.',
          'We keep data while your account is active. Transaction records may be kept longer where accounting and tax law requires.',
        ],
      },
      {
        id: 'your-rights',
        heading: 'Your rights',
        body: [
          'Under Decree 13/2023/ND-CP you have the right to be informed, to give or withdraw consent, to access, correct and request deletion of your data, to restrict or object to its processing, and to complain. To exercise these rights, contact us as shown under Contact below.',
        ],
      },
      {
        id: 'data-deletion',
        heading: 'Deleting your account and data',
        body: [
          'To delete your account and personal data:',
          {
            list: [
              'Email cskh@datxevui.com from your account’s email address (or message us under Support while signed in) with the subject “Account deletion request”.',
              'We verify that you own the account, delete it together with your personal data, and tell you when it is done.',
              'If you signed in with Google or Facebook, you can also remove DatXeVui’s access in that account’s security settings; this stops the sign-in, and the data we hold is deleted once you send the request above.',
            ],
          },
          'Transaction records the law requires us to keep are kept to a minimum and no longer linked to your account.',
        ],
      },
      {
        id: 'children',
        heading: 'Children',
        body: [
          'Accounts are for people aged 16 and over. Details of child passengers are provided by the adult who books, and are used only for that trip.',
        ],
      },
      {
        id: 'changes-contact',
        heading: 'Changes and contact',
        body: [
          'When this policy changes we update the date at the top and announce important changes on the website.',
          'Questions about your personal data: cskh@datxevui.com or hotline 1900 6067.',
        ],
      },
    ],
  },
}
