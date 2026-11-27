import { slideSize, type PresentationDoc } from '@ai-xiutu/contracts';
import { snapshotSvg } from '@ai-xiutu/contracts/office-data';
import { loadOfficePicture, officePng } from './office-images';

export async function exportPresentation(title: string, presentation: PresentationDoc) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.title = title;
  const inches = 7.5 / slideSize.height;
  const pictures = new Map<string, Awaited<ReturnType<typeof officePng>>>();
  for (const page of presentation.slides) {
    const slide = deck.addSlide();
    slide.background = { color: page.background.slice(1) };
    for (const element of page.elements) {
      const x = element.x * inches,
        y = element.y * inches;
      const w = element.width * inches,
        h = element.height * inches;
      const rotate = (element.rotation + 360) % 360;
      if (element.kind === 'text') {
        slide.addText(element.text, {
          x,
          y,
          w,
          h,
          rotate,
          margin: 0,
          valign: 'top',
          align: element.align,
          color: element.color.slice(1),
          bold: element.bold,
          fontFace: element.font,
          fontSize: element.size,
        });
      } else if (element.kind === 'shape') {
        slide.addShape(element.shape === 'ellipse' ? deck.ShapeType.ellipse : deck.ShapeType.rect, {
          x,
          y,
          w,
          h,
          rotate,
          fill: { color: element.color.slice(1) },
          line: { transparency: 100 },
        });
      } else {
        let image;
        if (element.kind === 'chart') {
          image = await officePng(
            new Blob([snapshotSvg(element.chart)], { type: 'image/svg+xml' }),
          );
        } else {
          image = pictures.get(element.assetId);
          if (!image) {
            image = await officePng(await loadOfficePicture(element.assetId));
            pictures.set(element.assetId, image);
          }
        }
        const scale = Math.min(w / image.width, h / image.height);
        const width = image.width * scale,
          height = image.height * scale;
        slide.addImage({
          data: image.url,
          x: x + (w - width) / 2,
          y: y + (h - height) / 2,
          w: width,
          h: height,
          rotate,
          altText: element.kind === 'image' ? element.alt : element.chart.title,
        });
      }
    }
  }
  return (await deck.write({ outputType: 'blob' })) as Blob;
}
