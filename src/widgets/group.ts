import { defineWidget } from '../core/widget.ts';

/**
 * Several widgets that move, scale, turn, fade and leave together. Members
 * join with `group: name`; the layout engine draws them (see Layout in
 * render.ts), so the group itself only draws its optional panel.
 */
export const group = defineWidget({
  type: 'group',
  description: 'Widgets that move together: members say `group: g`. Props: at/origin (move the whole group), scale, rotate (degrees), opacity, panel',
  defaults: { scale: 1, rotate: 0 },
  render: () => [],
});
