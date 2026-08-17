'use client'

import { memo, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Card } from '@/components/ui/card'
import { Phone, Mail, MessageSquare, HelpCircle, Headphones } from 'lucide-react'

type Faq = {
  q: string
  a: string
}

const FAQS: Faq[] = [
  {
    q: 'Làm thế nào để đặt vé xe trên VeXeVN?',
    a: 'Chỉ với 4 bước đơn giản: (1) Tìm chuyến xe phù hợp theo điểm đi/đến và ngày giờ. (2) Chọn ghế yêu thích trên sơ đồ ghế trực quan. (3) Thanh toán qua MoMo, VNPay, ZaloPay hoặc thẻ ngân hàng. (4) Nhận vé điện tử qua SMS và email ngay sau khi thanh toán thành công.',
  },
  {
    q: 'Tôi có thể đổi hoặc hoàn vé không?',
    a: 'Có. Bạn được đổi vé miễn phí trước 24 giờ so với giờ khởi hành. Với hoàn vé: thu phí 10% nếu hoàn trước 24 giờ, thu phí 30% nếu hoàn trong vòng 24 giờ, và không hoàn vé sau giờ khởi hành. Bạn có thể thực hiện đổi/hoàn trực tiếp trong mục "Vé của tôi".',
  },
  {
    q: 'Những phương thức thanh toán nào được hỗ trợ?',
    a: 'VeXeVN hỗ trợ MoMo, VNPay, ZaloPay, Visa, Mastercard và chuyển khoản ngân hàng. Tất cả giao dịch đều được mã hoá SSL 256-bit và tuân thủ chuẩn bảo mật PCI DSS, đảm bảo an toàn tuyệt đối cho thông tin thẻ và tài khoản của bạn.',
  },
  {
    q: 'Vé điện tử có hợp lệ không?',
    a: 'Có. Vé điện tử trên VeXeVN có mã QR và được Bộ GTVT cấp phép hoạt động. Bạn chỉ cần xuất trình mã QR trên điện thoại khi lên xe, nhân viên sẽ quét mã để xác nhận. Không cần in vé giấy, thân thiện với môi trường.',
  },
  {
    q: 'Tôi có được chọn ghế cụ thể không?',
    a: 'Có. VeXeVN hiển thị sơ đồ ghế chi tiết theo từng loại xe (limousine, giường nằm, ghế ngồi). Bạn có thể chọn ghế trực quan theo tầng, vị trí cửa sổ/lối đi, và xem ngay giá tương ứng với từng ghế trước khi xác nhận đặt vé.',
  },
  {
    q: 'Trẻ em có được giảm giá không?',
    a: 'Có chính sách ưu đãi cho trẻ em: trẻ dưới 2 tuổi đi miễn phí (không có chỗ ngồi riêng), trẻ từ 2-5 tuổi được giảm 50% giá vé, trẻ từ 6 tuổi trở lên mua vé như người lớn. Khi đặt vé, vui lòng khai báo đúng độ tuổi để nhận mức giá tương ứng.',
  },
  {
    q: 'Nếu xe đến trễ thì sao?',
    a: 'VeXeVN cam kết đền bù 100% giá vé nếu xe trễ quá 30 phút so với giờ khởi hành đã thông báo. Bạn vui lòng liên hệ hotline 1900 6067 hoặc chat trực tiếp với nhà xe trong phần "Theo dõi xe" để được hỗ trợ và nhận bồi thường theo quy định.',
  },
  {
    q: 'Làm sao để theo dõi chuyến xe?',
    a: 'Tính năng "Theo dõi xe trực tiếp" có sẵn trong trang chi tiết chuyến đi. Bạn sẽ thấy vị trí xe real-time trên bản đồ, dự kiến giờ đến trạm đón, và nhận thông báo push khi xe sắp tới nơi. Tính năng này cần nhà xe hỗ trợ GPS — áp dụng cho hơn 90% chuyến xe trên VeXeVN.',
  },
]

export const FaqSection = memo(function FaqSection() {
  // Allow multiple items open at the same time for easier reading.
  const [openItems, setOpenItems] = useState<string[]>([])

  return (
    <section className="bg-slate-50" aria-labelledby="faq-heading">
      <div className="container mx-auto max-w-6xl py-16 px-4">
        {/* Heading */}
        <div className="text-center mb-10 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-rose-700 text-xs font-semibold mb-4">
            <HelpCircle className="size-3.5" />
            FAQ
          </div>
          <h2
            id="faq-heading"
            className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900"
          >
            Câu hỏi thường gặp
          </h2>
          <p className="mt-3 text-slate-600 text-base md:text-lg">
            Mọi thắc mắc của bạn được giải đáp
          </p>
        </div>

        {/* Two-column accordion grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left column */}
          <Card className="p-4 md:p-6 shadow-sm border-slate-200 bg-white">
            <Accordion
              type="multiple"
              value={openItems}
              onValueChange={setOpenItems}
              className="w-full"
            >
              {FAQS.slice(0, 4).map((faq, i) => (
                <AccordionItem key={faq.q} value={`item-${i + 1}`}>
                  <AccordionTrigger className="text-sm md:text-base font-semibold text-slate-900 hover:no-underline">
                    <span className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-[10px] font-bold text-rose-700">
                        {i + 1}
                      </span>
                      <span className="text-left">{faq.q}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-slate-600 leading-relaxed pl-7">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Card>

          {/* Right column */}
          <Card className="p-4 md:p-6 shadow-sm border-slate-200 bg-white">
            <Accordion
              type="multiple"
              value={openItems}
              onValueChange={setOpenItems}
              className="w-full"
            >
              {FAQS.slice(4).map((faq, i) => (
                <AccordionItem key={faq.q} value={`item-${i + 5}`}>
                  <AccordionTrigger className="text-sm md:text-base font-semibold text-slate-900 hover:no-underline">
                    <span className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-[10px] font-bold text-rose-700">
                        {i + 5}
                      </span>
                      <span className="text-left">{faq.q}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-slate-600 leading-relaxed pl-7">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Card>
        </div>

        {/* Contact CTA */}
        <div className="mt-10 rounded-2xl bg-linear-to-br from-slate-900 to-rose-900 p-6 md:p-8 text-white shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-full bg-white/10 p-3">
                <Headphones className="size-6" />
              </div>
              <div>
                <h3 className="text-lg md:text-xl font-bold">Liên hệ hỗ trợ</h3>
                <p className="text-sm text-white/70 mt-1">
                  Đội ngũ chăm sóc khách hàng sẵn sàng 24/7 để giải đáp mọi câu hỏi.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full md:w-auto">
              <a
                href="tel:19006067"
                className="group flex items-center gap-3 rounded-xl bg-white/10 hover:bg-white/15 transition-colors px-4 py-3 ring-1 ring-white/10"
              >
                <Phone className="size-5 text-rose-300" />
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/60">
                    Hotline
                  </div>
                  <div className="text-sm font-semibold">1900 6067</div>
                </div>
              </a>
              <a
                href="mailto:cskh@vexevn.vn"
                className="group flex items-center gap-3 rounded-xl bg-white/10 hover:bg-white/15 transition-colors px-4 py-3 ring-1 ring-white/10"
              >
                <Mail className="size-5 text-rose-300" />
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/60">
                    Email
                  </div>
                  <div className="text-sm font-semibold">cskh@vexevn.vn</div>
                </div>
              </a>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/60 border-t border-white/10 pt-4">
            <span className="inline-flex items-center gap-1.5">
              <MessageSquare className="size-3.5" />
              Chat trực tiếp với nhân viên
            </span>
            <span>•</span>
            <span>Phản hồi trong vòng 5 phút</span>
            <span>•</span>
            <span>Hỗ trợ tiếng Việt &amp; English</span>
          </div>
        </div>
      </div>
    </section>
  )
})
