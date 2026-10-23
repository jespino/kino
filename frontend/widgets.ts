// Custom widgets available in the browser studio. Add your own here.
import type { WidgetDef } from '../src/index.ts';
import { gauge } from '../examples/widgets/gauge.ts';

export const customWidgets: WidgetDef<any>[] = [gauge];
