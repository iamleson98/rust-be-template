/**
 * Brand detail route — `/brands/$slug`
 *
 * Deep-linkable brand profile page. Replaces the old `brandDetailId` +
 * BrandDetailDialog pattern.
 */
import { useParams, useNavigate } from '@tanstack/react-router'
import { BrandDetailDialog } from '@/components/bus/brand-detail-dialog'

export function BrandDetailPage() {
  const { slug } = useParams({ from: '/brands/$slug' })
  const navigate = useNavigate()

  return (
    <BrandDetailDialog
      slug={slug}
      onClose={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
          window.history.back()
        } else {
          navigate({ to: '/' })
        }
      }}
    />
  )
}
