import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { authLogoutMutation, authMeOptions } from "@spa/api";
import { useT } from "@spa/lib/i18n";
import { useSession } from "@spa/stores/session";

/** The server-verified session; `data` is undefined while signed out.
 * A signed-in tab refreshes every 5 minutes so a session that died
 * server-side (expired refresh cookie, logout in another tab) is detected
 * while the tab is open — `refetchOnWindowFocus` is off globally, and
 * without a heartbeat a long-lived tab would keep rendering a private
 * console whose every widget 401s (SessionSync then moves it to the login
 * page). A signed-out tab has nothing to detect, so it does not poll: on the
 * Free plan every idle anonymous tab would otherwise cost a Worker request
 * every interval. */
export function useAuthMe() {
  return useQuery({
    ...authMeOptions(),
    retry: false,
    refetchInterval: (query) => (query.state.data ? 5 * 60_000 : false),
  });
}

/** Returns a function that signs out, drops every cache, and goes home. */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setUser = useSession((s) => s.setUser);
  const t = useT();

  const { mutate } = useMutation({
    ...authLogoutMutation(),
    onSuccess: () => {
      queryClient.clear();
      setUser(null);
      toast.success(t("auth.logoutSuccess"));
      navigate({ to: "/" });
    },
    onError: () => toast.error(t("layout.header.logoutFailed")),
  });
  return () => mutate({});
}
