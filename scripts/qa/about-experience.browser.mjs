/**
 * About experience gates for the existing isolated web-account-smoke harness.
 * This module never starts a browser, API, account or paid task. All assertions
 * use the rendered DOM, native input, decoded image metadata or canvas pixels.
 * Call once with the harness's newContext/check/capture/until/report helpers.
 */
import assert from 'node:assert/strict';

const desktop = { width: 1440, height: 960 };

const localeCases = [
  { locale: 'zh-CN', viewport: desktop },
  { locale: 'zh-TW', viewport: { width: 390, height: 844 } },
  { locale: 'en', viewport: { width: 320, height: 568 } },
];

async function canvasPixels(canvas) {
  return canvas.evaluate((element) => {
    const context = element.getContext('2d');
    if (!context || !element.width || !element.height) return null;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let checksum = 2166136261;
    let opaque = 0;
    for (let i = 0; i < pixels.length; i += 1) {
      checksum = Math.imul(checksum ^ pixels[i], 16777619) >>> 0;
      if (i % 4 === 3 && pixels[i] > 0) opaque += 1;
    }
    return { width: element.width, height: element.height, checksum, opaque };
  });
}

async function decodedImage(image, expectedPath, dimensions, until) {
  const state = await until(async () => {
    const value = await image.evaluate((element) => ({
      complete: element.complete,
      width: element.naturalWidth,
      height: element.naturalHeight,
      pathname: new URL(element.currentSrc || element.src, location.href).pathname,
      origin: new URL(element.currentSrc || element.src, location.href).origin,
      pageOrigin: location.origin,
      alt: element.alt,
      loading: element.loading,
    }));
    return value.pathname === expectedPath && value.complete && value.width > 0 && value.height > 0
      ? value
      : null;
  }, `decode the actual ${expectedPath} image`);
  assert.equal(
    state.pathname,
    expectedPath,
    'The visible image must use its intended bundled asset',
  );
  assert.equal(
    state.origin,
    state.pageOrigin,
    'Public examples and UI captures stay on this origin',
  );
  assert.deepEqual(
    [state.width, state.height],
    dimensions,
    `${expectedPath} has its full source size`,
  );
  assert.ok(state.alt.trim(), `${expectedPath} needs a useful localized description`);
  return state;
}

async function selectLocale(page, locale) {
  await page.locator('.about-header .language-select select').selectOption(locale);
  await page.waitForFunction((value) => document.documentElement.lang === value, locale);
  await page.locator(`.about-page[data-locale="${locale}"]`).waitFor();
}

async function assertActiveFeature(page, index, until) {
  const article = page.locator('.experience-feature').nth(index);
  await until(
    async () => (await article.getAttribute('aria-pressed')) === 'true',
    `feature ${index + 1} responds to the input`,
  );
  const image = page.locator('.experience-tour-image').nth(index);
  await until(
    async () =>
      image.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.getAttribute('aria-hidden') === 'false' &&
          style.visibility === 'visible' &&
          Number(style.opacity) === 1
        );
      }),
    `feature ${index + 1} finishes its visible transition`,
  );
  assert.equal(await page.locator('.experience-feature[aria-pressed="true"]').count(), 1);
  assert.equal(await page.locator('.experience-tour-image[aria-hidden="false"]').count(), 1);
}

// Only the wheel advances this helper: no DOM scrollTo/scrollIntoView shortcut.
async function wheelTo(page, selector, until) {
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const position = await page.locator(selector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const header = document.querySelector('.about-header')?.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        header: header?.bottom ?? 0,
        viewport: innerHeight,
        y: scrollY,
        maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      };
    });
    const reachesEnd = position.maximum - position.y <= 1;
    if (
      (position.top < position.viewport * 0.76 ||
        (reachesEnd && position.top < position.viewport - 1)) &&
      position.bottom > position.header + 24
    )
      return position.y;
    const direction = position.top < position.header ? -1 : 1;
    assert.ok(
      direction > 0 ? position.y < position.maximum - 1 : position.y > 1,
      `${selector} must be reachable through ordinary document scrolling`,
    );
    await page.mouse.move(12, Math.round(position.viewport * 0.65));
    await page.mouse.wheel(0, Math.round(position.viewport * 0.62) * direction);
    await until(
      async () => Math.abs((await page.evaluate(() => scrollY)) - position.y) > 1,
      `the document moves toward ${selector}`,
    );
    let previous = null;
    let stable = 0;
    await until(async () => {
      const y = await page.evaluate(() => scrollY);
      stable = y === previous ? stable + 1 : 0;
      previous = y;
      return stable >= 2;
    }, `the native wheel settles at ${selector}`);
  }
  assert.fail(`Native wheel did not reach ${selector} within the bounded page traversal`);
}

async function noTextClipping(page) {
  const overflows = await page.locator('.about-page').evaluate((root) => {
    const result = [];
    for (const element of root.querySelectorAll('h1,h2,h3,p,.feature-art-note,.study-range')) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden')
        continue;
      if (element.scrollWidth > element.clientWidth + 1)
        result.push({ tag: element.tagName, text: element.textContent?.trim().slice(0, 80) });
    }
    return {
      text: result,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  assert.deepEqual(overflows.text, [], 'Public titles, descriptions and captions must wrap');
  assert.ok(overflows.page <= 1, 'The public page must not require horizontal scrolling');
}

async function tracePointer(page) {
  const bounds = await page.locator('.about-hero').boundingBox();
  assert.ok(bounds, 'The pointer interaction needs the visible hero');
  // The hero padding is an observed decorative region, away from any control.
  const y = bounds.y + 24;
  const left = bounds.x + bounds.width * 0.2;
  const right = bounds.x + bounds.width * 0.8;
  await page.mouse.move(left, y);
  await page.mouse.move(right, y + 14, { steps: 24 });
  await page.mouse.move(left + (right - left) * 0.3, y + 30, { steps: 24 });
}

export async function runAboutExperienceChecks({ newContext, check, capture, until, report }) {
  const evidence = { tour: null, motion: null, studies: [], responsive: [], faq: [], agent: null };
  report.aboutExperience = evidence;
  const withPublicPage = async (name, viewport, run) => {
    const { context, page } = await newContext(viewport, 'about');
    const mutations = [];
    const observe = request => { const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && path.startsWith('/v1/')) mutations.push(`${request.method()} ${path}`); };
    page.on('request', observe);
    try { const result = await run(page); assert.deepEqual(mutations, [], `${name} must not upload, authenticate or start a paid task`); return result; }
    catch (error) { await capture(page, `about-r3-${name}-failure`).catch(() => {}); throw error; }
    finally { page.off('request', observe); await context.close(); }
  };
  await check('About has unique editorial art and synchronized slow wheel, hover and keyboard chapters', async () =>
    withPublicPage('tour', desktop, async page => {
      const hero = await decodedImage(page.locator('.hero-artwork img'), '/about/hero-editorial.webp', [1536,1024], until);
      assert.equal(hero.loading, 'eager');
      assert.ok((await page.locator('.about-header').boundingBox()).height <= 60, 'Header should leave room for the work');
      await capture(page, 'about-r3-hero-desktop');
      await wheelTo(page, '.experience-tour-sticky', until);
      const features = page.locator('.experience-feature');
      assert.equal(await features.count(), 4);
      await features.nth(1).hover(); await assertActiveFeature(page, 1, until);
      await decodedImage(page.locator('.experience-tour-image').nth(1).locator('img'), '/about/local-stilllife.webp', [1536,1024], until);
      await features.nth(1).focus(); await page.mouse.move(10, 250); await page.keyboard.press('Tab');
      assert.equal(await features.nth(2).evaluate(el => document.activeElement === el), true);
      await assertActiveFeature(page, 2, until);
      await capture(page, 'about-r3-portrait-annotations');
      await features.nth(3).hover(); await assertActiveFeature(page, 3, until);
      await page.locator('.feature-artwork-footer button').click();
      await decodedImage(page.locator('.feature-interface img'), '/about/layers-zh-CN.webp', [1440,960], until);
      await capture(page, 'about-r3-actual-interface-inline');
      await page.locator('.feature-interface-close').click();
      assert.equal(await page.locator('.feature-interface').count(),0);
      const geometry = await page.locator('.experience-tour').evaluate(el => ({height:el.offsetHeight,viewport:innerHeight}));
      assert.ok(geometry.height >= geometry.viewport*3.8, 'Each chapter needs a readable scroll interval');
      const activeBefore = await page.locator('.experience-tour').getAttribute('data-active');
      await page.mouse.move(10,600); await page.mouse.wheel(0,24);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('.experience-tour').getAttribute('data-active'), activeBefore, 'A tiny wheel movement must not erase a manual selection');
      const positions=[];
      for(const selector of ['#agent h2','#try h2','.about-paths h2','#together h2','.about-devices h2','#questions h2','.about-closing h2','.about-footer'])
        positions.push({selector,y:await wheelTo(page,selector,until)});
      await noTextClipping(page);
      const distinct=await page.locator('.hero-artwork img,.experience-tour-image img,.agent-photo-source img,.team-visual > .about-image img').evaluateAll(images => images.map(img=>new URL(img.src).pathname));
      assert.equal(new Set(distinct).size, distinct.length, 'Different chapters must not recycle the same photograph');
      evidence.tour={hero,positions,distinct,hover:true,keyboard:true,nativeWheel:true,apiMutations:0}; return evidence.tour;
    }));

  await check('Agent, voice and team illustrations change content and spatial state without starting services', async () =>
    withPublicPage('creative-states', desktop, async page => {
      await page.locator('.agent-visual').scrollIntoViewIfNeeded();
      const steps=page.locator('.agent-steps button');
      await steps.nth(0).click();
      const before=await page.locator('.agent-photo-source').boundingBox();
      await steps.nth(1).click();
      await until(async()=>page.locator('.agent-tools').evaluate(el=>getComputedStyle(el).opacity==='1'), 'Agent tool stage enters');
      const tools=await page.locator('.agent-photo-source').boundingBox();
      assert.ok(tools.width < before.width * .85, 'The source visibly moves and scales to make room for tools');
      await steps.nth(2).click();
      await until(async()=>page.locator('.agent-candidates').evaluate(el=>getComputedStyle(el).opacity==='1'), 'Agent candidates enter');
      await page.locator('.agent-candidate > button').nth(1).click();
      assert.equal(await page.locator('.agent-candidate > button').nth(1).getAttribute('aria-pressed'),'true');
      await decodedImage(page.locator('.agent-candidate').nth(1).locator('img'), '/about/agent-candidate-1.webp',[768,512],until);
      await capture(page,'about-r3-agent-candidates');
      await steps.nth(3).click();
      await until(async()=>page.locator('.agent-decision').evaluate(el=>getComputedStyle(el).opacity==='1'), 'Decision stage enters');
      await page.locator('.voice-pill button').click();
      assert.equal(await page.locator('.voice-pill button').getAttribute('aria-pressed'),'true');
      await page.locator('.voice-pill button').press('Escape');
      assert.equal(await page.locator('.voice-pill button').getAttribute('aria-pressed'),'false');
      await page.locator('.voice-modes button').nth(1).click();
      assert.ok((await page.locator('.voice-transcript').innerText()).includes('只提亮人物'));
      await page.locator('.voice-modes button').nth(2).click();
      assert.equal(await page.locator('.voice-pill button').getAttribute('aria-pressed'),'false');
      await capture(page,'about-r3-voice-states');
      await page.locator('.team-modes button').nth(0).click();
      assert.equal(await page.locator('.team-visual').getAttribute('data-team'),'false');
      await page.locator('.team-modes button').nth(1).click();
      await page.locator('.team-presence button').nth(1).click();
      assert.equal(await page.locator('.team-visual').getAttribute('data-member'),'1');
      await page.locator('.team-versions button').nth(2).click();
      assert.equal(await page.locator('.team-visual').getAttribute('data-version'),'3');
      await capture(page,'about-r3-team-regions');
      const device=[];
      for(let index=0;index<3;index++) {
        await page.locator('.device-modes button').nth(index).click();
        assert.equal(await page.locator('.device-composition').getAttribute('data-device'),String(index));
        device.push(await page.locator('.device-phone').boundingBox());
      }
      assert.equal(await page.locator('.device-phone figcaption').count(),0, 'Device capture has no text pasted over it');
      await capture(page,'about-r3-device-phone');
      evidence.agent={sourceBefore:before,sourceWithTools:tools,candidates:true,voiceStates:true,teamStates:true,device,apiMutations:0};return evidence.agent;
    }));

  await check('Each preset updates all eight real parameters; comparison keeps precise pixels and keyboard control', async()=>
    withPublicPage('study', desktop, async page=>{
      await page.locator('.color-study').scrollIntoViewIfNeeded();
      await page.locator('.study-compare').waitFor();
      const presets=[
        {index:0,values:[.12,10,4,-4,-16,14,12,6]},
        {index:1,values:[.18,4,18,12,-28,18,24,16]},
        {index:2,values:[.22,20,-16,-10,-30,26,6,-12]},
      ];
      for(const preset of presets){
        await page.locator('.study-presets button').nth(preset.index).click();
        const values=await page.locator('.study-adjustments input').evaluateAll(inputs=>inputs.map(input=>Number(input.value)));
        assert.deepEqual(values,preset.values,'The displayed controls are the exact preset recipe');
        await page.locator('.study-picture[aria-busy="false"]').waitFor();
        evidence.studies.push({index:preset.index,values,pixels:await canvasPixels(page.locator('canvas.study-result'))});
      }
      assert.equal(new Set(evidence.studies.map(x=>x.pixels.checksum)).size,3,'All looks produce distinct real pixels');
      const oldValues=await page.locator('.study-adjustments input').evaluateAll(inputs=>inputs.map(input=>Number(input.value)));
      await page.locator('.study-range-warmth input').press('ArrowRight');
      const newValues=await page.locator('.study-adjustments input').evaluateAll(inputs=>inputs.map(input=>Number(input.value)));
      assert.equal(newValues[1],oldValues[1]+1); assert.deepEqual(newValues.filter((_,i)=>i!==1),oldValues.filter((_,i)=>i!==1));
      assert.equal(await page.locator('.study-adjustments').getAttribute('data-preset'),'custom');
      await page.locator('.study-compare').press('Home');assert.equal(await page.locator('.study-compare').inputValue(),'0');
      await page.locator('.study-compare').press('End');assert.equal(await page.locator('.study-compare').inputValue(),'100');
      await page.locator('.study-compare').press('ArrowLeft');assert.equal(await page.locator('.study-compare').inputValue(),'99');
      const bounds=await page.locator('.study-picture').boundingBox();
      await page.mouse.move(bounds.x+bounds.width*.2,bounds.y+bounds.height*.45);
      await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+bounds.height*.5,{steps:12});
      const divider=await page.locator('.compare-edge > path').getAttribute('d');
      await page.mouse.up();
      assert.ok(divider.includes('C'), 'The visible comparison boundary is a curve');
      assert.equal(await page.locator('.study-result').evaluate(el=>getComputedStyle(el).filter),'none','No blur is applied to editing pixels');
      assert.equal(await page.locator('.study-picture').evaluate(el=>getComputedStyle(el).outlineStyle),'none','The image never gets a dark focus frame');
      await page.mouse.move(10,10);
      await capture(page,'about-r3-real-eight-parameter-study');
      await page.locator('.study-open').click(); await page.waitForURL(url=>url.hash==='#/studio');
      await page.getByLabel('选择照片',{exact:true}).waitFor({state:'attached'});
      assert.equal(await page.locator('canvas[aria-label="照片编辑预览"]').count(),0,'Starting work leaves image choice to the user');
      return {presets:evidence.studies,customPreservesValues:true,comparisonKeyboard:true,curvePath:divider,sharpPixels:true,ownWorkEntry:true,apiMutations:0};
    }));

  await check('About FAQ reserves its width and height, and all three languages fit narrow screens', async()=>{
    for(const item of localeCases) await withPublicPage(`responsive-${item.locale}`,item.viewport,async page=>{
      await selectLocale(page,item.locale);
      await decodedImage(page.locator('.hero-artwork img'),'/about/hero-editorial.webp',[1536,1024],until);
      await capture(page,`about-r3-${item.locale}-${item.viewport.width}-hero`);
      await page.locator('.about-faq').scrollIntoViewIfNeeded();
      const geometry=()=>page.locator('.faq-layout').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,next:document.querySelector('.about-closing').getBoundingClientRect().top+scrollY}));
      const baseline=await geometry();
      for(let index=0;index<5;index++){
        await page.locator('.about-question button').nth(index).click();
        const next=await geometry();
        assert.ok(Math.abs(next.width-baseline.width)<1 && Math.abs(next.height-baseline.height)<1 && Math.abs(next.next-baseline.next)<1,'FAQ changes only its answer, never the next section position');
        assert.equal(await page.locator('.question-answer[aria-hidden="false"]').count(),1);
      }
      await noTextClipping(page); await capture(page,`about-r3-${item.locale}-${item.viewport.width}-faq`);
      await page.locator('.color-study').scrollIntoViewIfNeeded();await page.locator('.study-compare').waitFor();
      await noTextClipping(page);await capture(page,`about-r3-${item.locale}-${item.viewport.width}-study`);
      const ranges=await page.locator('.study-adjustments input').evaluateAll(inputs=>inputs.map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height};}));
      assert.equal(ranges.length,8);assert.ok(ranges.every(r=>r.width>=80 && r.height>=32),'Each parameter has a reachable track');
      evidence.faq.push({locale:item.locale,geometry:baseline,stable:true});evidence.responsive.push({locale:item.locale,viewport:item.viewport,ranges});
    });return {faq:evidence.faq,responsive:evidence.responsive,apiMutations:0};
  });

  await check('Pointer decoration respects idle, offscreen, reduced motion and readable reveals', async()=>
    withPublicPage('motion',desktop,async page=>{
      await page.emulateMedia({reducedMotion:'no-preference'});
      const canvas=page.locator('.about-hero .about-pointer-ribbons canvas');
      await until(async()=>(await canvasPixels(canvas))?.width>1,'Pointer canvas sizes');
      const baseline=await canvasPixels(canvas); await tracePointer(page);
      const drawn=await until(async()=>{const v=await canvasPixels(canvas);return v&&v.opaque>baseline.opaque&&v.checksum!==baseline.checksum?v:null;},'Pointer paints a real trace');
      await capture(page,'about-r3-pointer-trace');
      await until(async()=>(await canvasPixels(canvas))?.checksum===baseline.checksum,'Pointer becomes idle');
      await tracePointer(page); const bounds=await page.locator('.about-hero').boundingBox();
      await page.mouse.move(10,desktop.height-60);await page.mouse.wheel(0,Math.ceil(bounds.y+bounds.height+desktop.height/2));
      await until(async()=>page.locator('.about-hero').evaluate(el=>el.getBoundingClientRect().bottom<=0),'Hero leaves viewport');
      await until(async()=>(await canvasPixels(canvas))?.checksum===baseline.checksum,'Offscreen canvas clears');
      await page.emulateMedia({reducedMotion:'reduce'});await page.keyboard.press('Control+Home');await page.waitForFunction(()=>scrollY===0);
      await tracePointer(page);
      const reduced=await page.locator('.about-hero').evaluate(root=>({
        canvasDisplay:getComputedStyle(root.querySelector('.about-pointer-ribbons canvas')).display,
        restOpacity:Number(getComputedStyle(root.querySelector('.about-pointer-ribbons__rest')).opacity),
        unreadable:[...document.querySelectorAll('.about-scroll-reveal,[data-reveal-piece]')].filter(el=>{const s=getComputedStyle(el);return Number(s.opacity)!==1||s.transform!=='none'||s.filter!=='none';}).length
      }));
      assert.equal(reduced.canvasDisplay,'none');assert.ok(reduced.restOpacity>0);assert.equal(reduced.unreadable,0);
      await capture(page,'about-r3-reduced-motion');evidence.motion={baseline,drawn,reduced,apiMutations:0};return evidence.motion;
    }));
}
