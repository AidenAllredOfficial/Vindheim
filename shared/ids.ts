// Element identifiers, in unlock order.
export const ELEMENT_ORDER = ['ember', 'frost', 'storm', 'stone', 'gale', 'tide', 'umbra', 'dawn'] as const;
export type ElementId = (typeof ELEMENT_ORDER)[number];
