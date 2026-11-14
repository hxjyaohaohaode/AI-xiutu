# External adapters

`createSms(env)` selects `alibaba-pnvs` or `tencent`. It defaults to Tencent for
existing deployments. Alibaba Cloud SMS Authentication sends app-generated
verification codes using `SendSmsVerifyCode`, version `2017-05-25`, with
ACS3-HMAC-SHA256 and fixed `dypnsapi.aliyuncs.com` HTTPS. Configure a RAM key
pair, an approved platform signature and a template for each OTP purpose. The
adapter sends the locally generated code and minutes as template variables.
The application keeps its existing purpose-scoped OTP verification and
expiry. Provider acceptance requires `Success`, `Code`, a request ID from the
response envelope or `Model.RequestId`, and a business receipt. A transport error or uncertain response is never retried
automatically. Mainland China numbers only. [Official SendSmsVerifyCode reference](https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-sendsmsverifycode)

`createTencentSms(env)` implements Tencent SMS `SendSms`, API `2021-01-11`,
with TC3-HMAC-SHA256. All three approved template IDs are required. By default
template parameters are `[code, expiryMinutes]`; set `TENCENT_SMS_CODE_ONLY=true`
only when the approved template has exactly one code parameter. An API acceptance
does not prove handset delivery. Ambiguous network results are `unknown`, never
automatically retried.

`createTencentTextModerator(env)` requires the Tencent key pair and an explicitly
approved `TENCENT_MODERATION_BIZ_TYPE`. It calls `TextModeration`, API `2020-12-29`,
using UTF-8 Base64 `Type:TEXT`. Only `Pass` permits use. Review, Block, unexpected
responses, timeouts and oversize input fail closed. This adapter covers text only.

`createTencentImageModerator(env)` requires the key pair and an explicit
`TENCENT_IMAGE_MODERATION_BIZ_TYPE`. It calls `ImageModeration`, API `2020-12-29`,
with `FileContent` Base64 and `Type:IMAGE`. It checks the actual single-frame image,
matching MIME type, sides greater than 50 and less than 10000 pixels, aspect ratio
less than 90, and Base64 content strictly smaller than 10 MiB. The check hashes the
exact supplied bytes and never silently resizes or substitutes a first frame.
Only `Pass` permits exposure. The worker moderates normalized stored PNG bytes.

All adapters use fixed HTTPS vendor hosts, bounded response bodies, timeouts, no redirects
and no secret/payload logging. There is no default account, fake SMS, approval
bypass, or automatic retry of a possibly charged request. Actual accounts,
approved templates, quotas, delivery and moderation quality remain untested
without operator-supplied credentials.

Configuration names:

- Common: `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`.
- SMS: `TENCENT_SMS_APP_ID`, `TENCENT_SMS_SIGN_NAME`,
  `TENCENT_SMS_TEMPLATE_REGISTER`, `TENCENT_SMS_TEMPLATE_LOGIN`,
  `TENCENT_SMS_TEMPLATE_RESET`; optional `TENCENT_SMS_REGION` (default `ap-guangzhou`)
  and `TENCENT_SMS_CODE_ONLY`.
- Moderation: `TENCENT_MODERATION_BIZ_TYPE`,
  `TENCENT_IMAGE_MODERATION_BIZ_TYPE`, optional `TENCENT_MODERATION_REGION`
  (default `ap-guangzhou`). Separate approved business policies are required.

Successful SMS acceptance requires the exact requested recipient and an upstream
request ID. Body interruption, missing receipts, malformed/oversize responses,
timeouts and internal failures remain unknown. No provider response is converted
to a successful send or moderation result merely because HTTP returned 200.

Official interface references checked 2026-11-09:

- https://cloud.tencent.com/document/api/382/55981
- https://cloud.tencent.com/document/api/1124/51860
- https://cloud.tencent.com/document/product/1125/53273
- https://cloud.tencent.com/document/api/213/30654

Unit/integration tests may inject adapters; those adapters are never enabled by
environment variables or installed in the public application.

## OpenAI test configuration

Set AI_MODERATION_PROVIDER=openai with a server-only OPENAI_API_KEY to use
the OpenAI moderation endpoint for frozen text and single PNG, JPEG or WebP
images. The default remains Tencent. The receipt includes the digest of the
exact input bytes; missing, incomplete or unknown results cannot authorize
a paid action or expose an image. The key never belongs in web configuration.
