import type { WidgetDef } from '../core/widget.ts';
import { box, button, circle, label } from './basic.ts';
import { array } from './array.ts';
import { struct } from './struct.ts';
import { matrix } from './matrix.ts';
import { table } from './table.ts';
import { listWidget } from './list.ts';
import { code } from './code.ts';
import { arrow, cursor, pointer } from './overlay.ts';
import { tabs } from './tabs.ts';
import { title } from './title.ts';
import { emoji } from './emoji.ts';
import { image } from './image.ts';
import { merge } from './merge.ts';
import { tree } from './tree.ts';
import { memory } from './memory.ts';
import { bits } from './bits.ts';
import { brace, callout, spotlight } from './annotate.ts';

export const builtinWidgets: WidgetDef<any>[] = [label, box, circle, button, array, struct, matrix, table, listWidget, code, tabs, title, emoji, image, merge, tree, memory, bits, arrow, pointer, cursor, callout, brace, spotlight];

export class WidgetRegistry {
  private defs = new Map<string, WidgetDef<any>>();

  constructor(defs: WidgetDef<any>[] = builtinWidgets) {
    defs.forEach((d) => this.register(d));
  }

  register(def: WidgetDef<any>) {
    this.defs.set(def.type, def);
  }

  get(type: string): WidgetDef<any> | undefined {
    return this.defs.get(type);
  }

  all(): WidgetDef<any>[] {
    return [...this.defs.values()];
  }
}
