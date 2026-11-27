import {
  slideSize,
  type DocumentLayout,
  type OfficeChartSnapshot,
  type PresentationDoc,
  type PresentationSlide,
  type SlideElement,
} from '@ai-xiutu/contracts';
import { createChartSnapshot, officeDataTable } from '@ai-xiutu/contracts/office-data';
import type { ProjectDocument } from '../lib/types';

export function blankSlide(name: string): PresentationSlide {
  return { id: crypto.randomUUID(), name, background: '#FFFFFF', elements: [] };
}

export function blankPresentation(name: string): PresentationDoc {
  return { version: 1, slides: [blankSlide(name)] };
}

export function newBox(width: number, height: number) {
  return {
    id: crypto.randomUUID(),
    x: Math.round((slideSize.width - width) / 2),
    y: Math.round((slideSize.height - height) / 2),
    width,
    height,
    rotation: 0,
  };
}

export function fitBox<T extends SlideElement>(element: T): T {
  const clamp = (n: number, low: number, high: number) =>
    Math.max(low, Math.min(high, Math.round(n)));
  const width = clamp(element.width, 36, slideSize.width);
  const height = clamp(element.height, 30, slideSize.height);
  return {
    ...element,
    width,
    height,
    x: clamp(element.x, 0, slideSize.width - width),
    y: clamp(element.y, 0, slideSize.height - height),
    rotation: clamp(element.rotation, -180, 180),
  };
}

export function snapBox(element: SlideElement, neighbors: SlideElement[], tolerance: number) {
  const others = neighbors.filter((item) => item.id !== element.id);
  function axis(value: 'x' | 'y', size: 'width' | 'height') {
    const targets = [0, slideSize[size] / 2, slideSize[size]];
    for (const item of others)
      targets.push(item[value], item[value] + item[size] / 2, item[value] + item[size]);
    let delta = tolerance + 1,
      guide: number | undefined;
    for (const target of targets) {
      for (const anchor of [
        element[value],
        element[value] + element[size] / 2,
        element[value] + element[size],
      ]) {
        const distance = target - anchor;
        if (Math.abs(distance) <= tolerance && Math.abs(distance) < Math.abs(delta)) {
          delta = distance;
          guide = target;
        }
      }
    }
    return { position: element[value] + (guide === undefined ? 0 : delta), guide };
  }
  const x = axis('x', 'width'),
    y = axis('y', 'height');
  const next = fitBox({ ...element, x: x.position, y: y.position });
  return {
    element: next,
    x: Math.abs(x.position - next.x) < 1 ? x.guide : undefined,
    y: Math.abs(y.position - next.y) < 1 ? y.guide : undefined,
  };
}

export function chartFromDocument(
  source: ProjectDocument,
  kind: DocumentLayout['chart'],
): OfficeChartSnapshot {
  const table = officeDataTable(source.body);
  if (!table) throw new Error('请选择包含一张数据表的文档或工作表。');
  return createChartSnapshot(table, source.title, kind, {
    documentId: source.id,
    version: source.version,
  });
}
