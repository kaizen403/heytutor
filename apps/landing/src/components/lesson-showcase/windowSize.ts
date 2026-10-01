/* The mockup's design size; the window body scales it to fit, exactly like
   DashboardStage does for the use-cases section. */
export const DESIGN_W = 1280
export const DESIGN_H = 762
/* The mockup's sidebar is 264px of the design width. Below the sm breakpoint
   the window frames only the main column — the same thing the shipping product
   does with its sidebar on a phone — so the board stays the subject instead of
   shrinking the whole desktop UI into a thumbnail. */
export const SIDEBAR_W = 264
export const MOBILE_MQ = '(max-width: 639px)'
