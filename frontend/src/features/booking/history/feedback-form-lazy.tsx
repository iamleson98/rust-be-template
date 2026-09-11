'use client'

// Extracted from the original 'my-bookings.tsx'.

import { lazy } from 'react'

// Lazy-load the FeedbackForm so its star-rating + photo-upload code only
// loads when a user actually opens the form on a completed booking.
export const FeedbackForm = lazy(() => import('@/features/feedback/feedback-form').then((m) => ({ default: m.FeedbackForm })))
export const FeedbackFormFallback = <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
