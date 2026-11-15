/** The one side-gutter scale the whole app uses: 16px on phones, 24px from `sm`, 32px from `lg`.
 * Pages are full width — there is deliberately no centred max-width wrapper anywhere (see the
 * project's UI rules); only modals, toasts and short empty-state copy are centred. */
export const PAGE_X = "px-4 sm:px-6 lg:px-8";

/** Full-width page shell: the gutter plus the vertical rhythm pages share. */
export const PAGE = `w-full flex-1 ${PAGE_X} py-8`;
