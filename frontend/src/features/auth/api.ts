import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { authLogoutMutation, authMeOptions } from '@/api'
import { useT } from '@/lib/i18n'
import { useSession } from '@/stores/session'

/** The server-verified session; `data` is undefined while signed out. */
export function useAuthMe() {
  return useQuery({ ...authMeOptions(), retry: false })
}

/** Returns a function that signs out, drops every cache, and goes home. */
export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const setUser = useSession((s) => s.setUser)
  const t = useT()

  const { mutate } = useMutation({
    ...authLogoutMutation(),
    onSuccess: () => {
      queryClient.clear()
      setUser(null)
      toast.success(t('auth.logoutSuccess'))
      navigate({ to: '/' })
    },
    onError: () => toast.error(t('layout.header.logoutFailed')),
  })
  return () => mutate({})
}
