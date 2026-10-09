import { useQuery } from '@tanstack/react-query'
import { adminBusLayoutsPresetsOptions } from '@/api'

/** Ready-made seat plans — static data, fetched once per session. */
export const usePresets = () =>
  useQuery({ ...adminBusLayoutsPresetsOptions(), staleTime: Number.POSITIVE_INFINITY })
