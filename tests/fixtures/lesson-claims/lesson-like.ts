// A module shaped like a lesson: it imports no claims module itself, only a helper that does (K0-E2).
import { helperValue } from './helper'

export const lessonLike = { text: `value ${helperValue()}` }
