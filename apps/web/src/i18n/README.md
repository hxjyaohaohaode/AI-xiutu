# Interface languages

The application supports `zh-CN`, `zh-TW`, and `en`. Simplified Chinese is the source language. English and Traditional Chinese dictionaries load separately when the user requests or preloads them. The initial Simplified Chinese page does not load either dictionary.

`initializeLocale()` runs before React mounts. It restores the browser preference and sets the document language. `setLocale(locale)` waits for the selected dictionary before publishing the new locale; a later request always wins. A failed download keeps the current language and gives the language control a visible retry state. `preloadLocale(locale)` never changes the selected language.

Components subscribe through `useLocale()` or `useI18n()`. The store does not change route keys, replace component owners, or remount the editor. Memoized display values that include translations or formatted dates must include the locale in their dependencies. API operations must not depend on the locale unless the operation explicitly accepts a language parameter.

## Writing copy

Pass only application-authored copy to `t`. Keep source strings in module-level metadata and translate them at the render boundary. Keep editable names, model output, prompts, request identifiers, file names, and server-owned labels outside translation calls.

Use complete messages with named parameters when word order can change:

```tsx
const { t } = useI18n();
return <p>{t('打开{name}', { name: project.title })}</p>;
```

Parameters are inserted once and never translated recursively. Unknown messages are returned unchanged so an unfamiliar diagnostic remains accurate. Do not replace a missing translation with unrelated generic text. When storing long-lived UI status, retain its source message and parameters until render so an active status can follow a language change.

`formatNumber` and `formatDateTime` use the active locale. Ledger dates retain the ledger's explicit timezone where specified by the existing product contract.

## Dictionaries and checks

The English catalog is split by feature. `traditional-generated.ts` contains the Traditional Chinese baseline with reviewed Taiwan terminology; account, workspace, and usage catalogs supply feature-specific phrasing. Core vocabulary is consistent with the introduction: 儲存, 匯出, 匯入, 專案, 本機, 帳號, 使用者, 檔案, 載入, 預設, 滑鼠, 螢幕, 筆刷, and 遮罩. These are precompiled dictionary values, never replacements applied to user text. Add exact messages to both languages whenever adding application copy. Do not use a DOM text replacement pass or a runtime script converter on arbitrary page content.

`test/i18n.test.ts` checks lazy-loading transactions, stale requests, load failure and retry, parameter preservation, catalog interpolation slots, declared source-copy coverage, numeric-tool metadata, and actual parameter control rendering in all three languages. Those checks do not replace browser layout review, user-content checks, or the backend contract tests.
