"""Adapt the original BDSP text/ROI rules to our shared PP-OCRv6 worker.

No Paddle runtime is constructed: every request uses ocr_service's existing
RapidOcrReader. Preserve geometry and confidence for characteristic matching.
"""
from auto_bdsp_rng.automation.auto_rng import pokemon_info_ocr as info
from auto_bdsp_rng.automation.auto_rng.ocr_regions import OcrRegionConfig, OCR_REGION_FIELDS


class RapidResultAdapter:
    def __init__(self, reader):
        self.reader = reader

    def predict(self, image):
        output = self.reader._engine(image, use_det=True, use_cls=False)
        boxes = getattr(output, 'boxes', None)
        texts, scores = getattr(output, 'txts', None), getattr(output, 'scores', None)
        return [{'rec_texts': [] if texts is None else list(texts),
                 'rec_scores': [] if scores is None else list(scores),
                 'rec_polys': [] if boxes is None else boxes.tolist()}]


def inspect_image(image, params, reader):
    operation = params.get('operation', 'text')
    field = params.get('field')
    if operation == 'field' and field not in OCR_REGION_FIELDS:
        raise ValueError('未知 OCR 项目')
    info._PADDLE_OCR = RapidResultAdapter(reader)
    config = OcrRegionConfig(params.get('regions') or {})
    if operation == 'field':
        region = config.resolve(field, image.shape)
        if region is None:
            raise ValueError('OCR 区域无效，请重新框选')
        return {'text': info.recognize_ocr_field(image, field, region)}
    if operation == 'notes':
        result = info.extract_pokemon_info(notes_image=image, ocr_regions=config)
        characteristic = info.match_characteristic_text(result.get('characteristic'))
        if characteristic is None:
            characteristic = info.recognize_characteristic_full_frame(image)
        return {**result, 'characteristic': characteristic, 'characteristic_match_failed': characteristic is None}
    if operation == 'stats':
        expansion = params.get('expansion', 0)
        if expansion not in (0,1,2):
            raise ValueError('能力值区域扩展参数无效')
        return info.extract_pokemon_info(stats_image=image, ocr_regions=config,
            stats_region_expansion_level=expansion, allow_stats_page_fallback=False)
    if operation == 'text':
        if field:
            region = config.resolve(field, image.shape)
            if region is None:
                raise ValueError('判闪区域无效')
            x,y,w,h = region.as_tuple()
            image = image[y:y+h,x:x+w]
        text, confidence = reader.read(image, language=params.get('language'))
        return {'text': text, 'confidence': confidence}
    raise ValueError('不支持的 OCR 操作')
