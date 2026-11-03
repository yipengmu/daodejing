# 《道德经》公益共读平台数据库设计预研稿（未批准）

- 状态：预研草案 v0.1；数据库设计尚未启动，本稿不作为实现基线
- 日期：2026-10-31
- 依据：[产品 Proposal](./proposal-spec.md)、[技术架构 Spec](./technical-architecture-spec.md)、[技术实施计划](./technical-implementation-plan.md)、[页面流程 Spec](./product-page-flow-spec.md)
- 数据库：独立 Neon PostgreSQL；Prisma 管理 schema 与迁移

## 1. 设计目标与当前边界

本文件是此前形成的未经批准的设计草案。按 2026-11-01 的产品决策，正式数据库设计尚未启动；本文中的实体、字段、索引和约束均不得直接视为已批准 schema 或编码依据。待 MVP-1 范围基线确认后，应基于产品 Spec 和技术架构重新评审、修订或替换本稿，再启动 Prisma schema / migrations。

当前数据库范围包括账号公开资料、经文章节与章节频道、固定道场、临时地点、单章节共读提交、章节分享、分享阅读量/爱心/评论、项目独立媒体资源引用和必要审计/幂等记录。当前不建 AI 内容索引、向量表、转写/摘要派生物、外部 AI 数据连接器或平台内容问答表。

### 设计原则

- 认证凭据由 auth-kit 管理；领域表只保存稳定的认证用户 ID，不复制手机号、邮箱、密码、验证码或 JWT。
- 一次用户提交就是一条 GatheringSubmission；每条只对应一个章节，多人提交不合并。
- 固定道场与临时地点分开；临时地点与创建它的提交一对一，不做地点识别或归并。
- MVP 分享只关联一个章节；频道与 Chapter 一对一，不创建活动频道。频道活跃排序依赖有效阅读、爱心和时间信号，不等同于全局推荐。
- 原始媒体在道德经项目独立对象存储；数据库保存 provider/namespace/object key 和元数据，不存媒体二进制或永久签名 URL。
- 经文内容必须带版本和来源状态；种子中“用户提供、尚未校勘”的文本不能标为已核定王弼本。
- 隐藏/逻辑删除影响所有公开查询和媒体授权读取；重要变更写入审计日志。

## 2. MVP 实体关系

- Auth User 一对一 User Profile。
- Avatar Preset 一对多 User Profile。
- Chapter 与 Text Edition 通过 Chapter Text 保存版本化原文；Chapter 与 Chapter Channel 一对一。
- Chapter 与 Chapter Material 一对多，保存白话解读/注释。
- User Profile 一对多 Dojo、Gathering Submission、Content Item。
- Gathering Submission 对应一个 Chapter，地点为固定 Dojo 或独立 Temporary Place。
- Content Item 对应一个 Chapter，可选关联一条 Gathering Submission 和一个 Dojo；允许记录外部来源 URL/署名，但不抓取全网。
- Content Item 有多个 Content Like、Content View Event 和 Content Comment；评论为单层并归属于原分享。
- Content Item 与 Media Asset 通过 Content Media 多对多关联。
- Publication Acknowledgement 记录发布告知确认；Audit Event 记录关键变更；Idempotency Record 防止请求重试重复创建。

认证表由 auth-kit 拥有，本稿不重新定义认证字段。Auth User 关联表示逻辑关系；是否在 PostgreSQL 建 FK，需与 auth-kit migration 所有权一起定。

## 3. 字段与表设计

以下字段名使用数据库 snake_case。主键建议 String @id @default(cuid())（PostgreSQL text），时间统一存 UTC timestamptz(3)；面向用户展示时按 Asia/Shanghai 格式化。枚举在 Prisma 中定义并以稳定大写值落库。created_at、updated_at 是通用字段，表中省略时仍应添加。

### 3.1 user_profiles：公开资料

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| auth_user_id | text | UNIQUE；对应 auth-kit 稳定用户 ID，不存手机号/邮箱 |
| display_name | varchar(80) | 必填；公开基础名称 |
| avatar_preset_id | text | FK → avatar_presets.id；注册后服务端自动分配 |
| profile_status | enum | ACTIVE / HIDDEN；默认 ACTIVE |
| created_at, updated_at | timestamptz | 创建、资料更新时刻 |

不在 Profile 中放登录邮箱、手机号、身份认证状态或未经审核的“老师/KOL”标签。首期页面只显示基础名称和头像。

### 3.2 avatar_presets：内置头像目录

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK，例如 dao-avatar-01 |
| asset_path | varchar(500) | 仓库或 CDN 内置资源路径；不放签名 URL |
| alt_text | varchar(120) | 无障碍替代文本 |
| sort_order | smallint | 选择器展示顺序 |
| is_active | boolean | 默认 true；停用后现有 Profile 仍可读 |

用 seed 预置约 10 个头像。注册 hook 从启用项中自动分配；不要把头像文件本身存进数据库。

### 3.3 chapters、text_editions、chapter_texts：经典文本版本

**chapters**

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| number | smallint | UNIQUE；限制 1—81，是跨版本稳定章节号 |
| created_at | timestamptz | 初始化时刻 |

**text_editions**

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| edition_key | varchar(100) | UNIQUE；如 user-supplied-2026-10-31 |
| title | varchar(200) | 版本显示名称 |
| text_label | varchar(200) | 底本/资料标签 |
| source_note | text | 录入来源与校勘说明 |
| language_code | varchar(20) | 如 zh-Hans |
| copyright_status | enum | UNKNOWN / PUBLIC_DOMAIN / LICENSED / RESTRICTED |
| review_status | enum | UNREVIEWED / IN_REVIEW / VERIFIED / REJECTED |
| is_default | boolean | 默认 false；全库至多一个默认版，使用部分唯一索引 |
| created_at, updated_at | timestamptz | 版本记录时间 |

**chapter_texts**

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| edition_id | text | FK → text_editions.id |
| chapter_id | text | FK → chapters.id |
| section_label | varchar(80) | 如“道经”“德经”，属于该版数据 |
| title | varchar(160) | 该版章名，可空 |
| original_text | text | 该版原文 |
| review_status | enum | UNREVIEWED / IN_REVIEW / VERIFIED |
| editorial_note | text | 校勘/录入备注，可空 |
| created_at, updated_at | timestamptz | 版本行修改时间 |

唯一约束 (edition_id, chapter_id)；索引 (chapter_id, edition_id)。版本来源、版权和校对责任记录在 text_editions，不把内容来源写死在前端。

### 3.4 chapter_materials：注释与白话解读

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| edition_id | text | FK → text_editions.id，说明其解释针对哪个版本 |
| chapter_id | text | FK → chapters.id |
| material_type | enum | 设计目标：区分白话解读和河上公古文注释；现有 BASIC_EXPLANATION 需保留兼容并经迁移后映射，具体枚举待实现时确定 |
| body | text | 注释/解读正文 |
| author_name | varchar(160) | 作者/整理者，可空 |
| source_note | text | 来源说明 |
| source_url | text | 外部来源可空 |
| review_status | enum | UNREVIEWED / IN_REVIEW / VERIFIED |
| sort_order | smallint | 同章多条材料排序 |
| created_at, updated_at | timestamptz | 时间 |

索引 (edition_id, chapter_id, material_type, review_status)。白话解读不与经典原文放在同一字段，UI 可显示不同来源和信任标签。

**注释数据补充设计（待实现）**：每章分别维护白话和河上公古注两类内容，固定前者后者的展示顺序。记录各自作者/整理者、来源版本、来源地址、许可与审校状态，并支持同一展示层的版本替换；禅桥老师版本确认后替换白话展示层，不能覆盖或重标古注。现有 `youth_easy_read` 为白话候选，`heshanggong_interpretation` 为现代转述，不是古注原文；真实古注缺失时独立标记待补。上述类型、来源和版本扩展尚未在 Prisma schema 中实现，需后续迁移与导入流程落实。

### 3.5 chapter_channels：81 个固定章节频道

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| chapter_id | text | UNIQUE FK → chapters.id，保证一章一个频道 |
| slug | varchar(100) | UNIQUE；稳定路由键，如 chapter-01 |
| status | enum | ACTIVE / HIDDEN；默认 ACTIVE |
| created_at, updated_at | timestamptz | 时间 |

频道由 seed 为 81 章预置；不按活动创建。当前一个 Content Item 只关联一个 chapter_id，因此不建多对多 ContentChapterLink。若未来开放跨章节分享，再增加显式 link 表和确认来源字段。

### 3.6 dojos：固定道场

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| created_by_auth_user_id | text | 创建账号稳定 ID |
| maintainer_auth_user_id | text | 当前主理人账号 ID；MVP 默认与创建者相同 |
| name | varchar(160) | 必填 |
| province_code, province_name | varchar / varchar | 省级筛选码与名称 |
| city_code, city_name | varchar / varchar | 城市筛选码与名称 |
| district_name | varchar(100) | 可空 |
| address | varchar(500) | 公开地址 |
| latitude, longitude | Decimal(9,6) | 固定道场地图坐标 |
| coordinate_system | enum | GCJ02 / BD09 / WGS84；与地图 provider adapter 对齐 |
| coordinate_source | varchar(200) | 坐标来源/核验材料说明 |
| coordinate_verified_at | timestamptz | 核验时间，可空 |
| description | text | 介绍，可空 |
| activity_method | text | 活动方式，可空 |
| regular_schedule | text | 常规共读时间规则，可空；以可读文本表达，如每周几/隔周/需提前询问 |
| welcomes_first_timers | boolean | 是否欢迎初次参与者；未知须另用 nullable 或状态字段表达，不把未知当作不欢迎 |
| contact_visibility | enum | HIDDEN / PUBLIC；控制联系方式是否匿名公开 |
| public_contact | varchar(300) | 仅在 contact_visibility=PUBLIC 时展示；不得填私人未授权联系方式 |
| signup_info_url | text | 可选外部报名说明/接龙链接；MVP 不提供站内 RSVP |
| status | enum | ACTIVE / HIDDEN / DELETED |
| created_at, updated_at | timestamptz | 最近更新时间由 updated_at 表示 |

索引 (status, province_code, city_code, name)、坐标查询索引。首期地图只读取状态为 ACTIVE 且坐标核验完成的固定道场。MVP 不实现道场合并或维护权交接工作流；变更由创建者/主理人权限检查控制。

### 3.7 gathering_submissions：单章节原始共读记录

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| submitter_auth_user_id | text | 必填；当前登录账号 ID |
| chapter_id | text | 必填 FK → chapters.id；一条记录只能一个章节 |
| location_type | enum | FIXED_DOJO / TEMPORARY_PLACE |
| dojo_id | text | FK → dojos.id，固定道场类型必填 |
| lead_reader_auth_user_id | text | 可空；若领读人为注册用户，关联其稳定账号 ID |
| lead_reader_name | varchar(160) | 必填展示名快照；无平台账号时为唯一身份资料；每场恰有一名领读人 |
| lead_reader_identity_type | enum | ACCOUNT / SELF_REPORTED；不等于平台核验身份 |
| activity_format | enum | 可空：IN_PERSON / ONLINE / HYBRID |
| submitted_at | timestamptz(3) | 服务端生成，客户端不得提供；UI 按分钟显示 |
| visibility | enum | OWNER_ONLY / PUBLIC；默认 PUBLIC。若允许用户隐藏活动记录，隐藏只控制前台访问，不减少原始审计数据 |
| status | enum | ACTIVE / HIDDEN / DELETED |
| created_at, updated_at | timestamptz | 时间 |

约束：FIXED_DOJO 时 dojo_id IS NOT NULL；TEMPORARY_PLACE 时 dojo_id IS NULL。另由 temporary_places.gathering_submission_id UNIQUE 保证临时地点与提交为一对一，并在事务服务中确保临时类型必须同时创建地点行。索引 (chapter_id, visibility, status, submitted_at DESC)、(submitter_auth_user_id, submitted_at DESC)、(dojo_id, submitted_at DESC)。不存可回填的活动发生时间、参与人数、重复组 ID 或合并字段。

一条成功提交对应一条记录。多人提交同一线下活动、或网络重试后再次主动提交，都不自动合并；同一 HTTP 请求重试通过 idempotency_records 去重。

### 3.8 temporary_places：单提交临时地点

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| gathering_submission_id | text | UNIQUE FK → gathering_submissions.id |
| created_by_auth_user_id | text | 到场活动发起人账号；应与提交人一致 |
| latitude, longitude | Decimal(9,6) | 单次前台定位坐标；仅在受控 API 内部使用 |
| coordinate_system | enum | 坐标系；默认采集来源对应值，转换后明确更新 |
| location_accuracy_m | Decimal(8,2) | 浏览器提供的精度，可空 |
| public_address | varchar(500) | 公开的街道级可到达地址，提交时供用户核对 |
| location_source | enum | DEVICE_GEOLOCATION / USER_CORRECTION |
| confirmed_by_auth_user_id | text | 确认可公开/可到达地址的到场发起人 |
| confirmed_at | timestamptz | 确认时间 |
| created_at, updated_at | timestamptz | 纠正地点时更新时间 |

索引 (created_by_auth_user_id, updated_at DESC)。只有本次记录的提交账号可编辑地点；服务端每次纠正写入 audit_events。匿名公开 API 只返回 public_address 等必要公开字段，不返回未经需要的高精度坐标。地点不复用、不识别重复、不归并；后续若地址争议需人工受理，不在本表预建归并关系。

### 3.9 content_items：章节分享

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| author_auth_user_id | text | 必填；作者固定为当前登录用户 |
| chapter_id | text | 必填 FK → chapters.id；MVP 单章节 |
| gathering_submission_id | text | 可空 FK → gathering_submissions.id |
| dojo_id | text | 可空 FK → dojos.id；分享可独立关联道场 |
| body | text | MVP 必填；纯媒体空正文不允许 |
| source_credit | varchar(500) | 作者/整理者/来源说明，可空 |
| public_identity_mode | enum | PROFILE / ANONYMOUS；逐条分享选择；后台 author_auth_user_id 始终保留 |
| public_display_name | varchar(80) | 分享发布时公开名称快照；匿名分享使用统一匿名名，不得回退到 Profile 名称 |
| public_avatar_preset_id | text | 可空 FK → avatar_presets.id；匿名分享可用通用匿名头像 |
| source_url | text | 可空 |
| status | enum | PUBLISHED / HIDDEN / DELETED；新建发布默认 PUBLISHED |
| published_at | timestamptz | 发布时间 |
| created_at, updated_at | timestamptz | 时间 |

索引 (chapter_id, status, published_at DESC)、(author_auth_user_id, status, created_at DESC)、(gathering_submission_id)、(dojo_id)。用户只能修改/隐藏/逻辑删除本人分享；公开查询必须过滤非 PUBLISHED 状态。阅读量使用有效去重的阅读事件计算。MVP 包含评论、爱心和章节内活跃排序；不建话题系统、评论回复、关注关系或全局推荐流。匿名展示是公开层的身份遮蔽，不是匿名账号；需防止 API、图片 EXIF、音频元数据和媒体文件名意外泄漏身份信息。

### 3.10 content_likes、content_view_events 与 content_comments：章节频道互动

**content_likes**

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| content_item_id | text | FK → content_items.id |
| author_auth_user_id | text | 必填；爱心用户，登录后操作 |
| created_at | timestamptz | 爱心时间 |

唯一约束 (content_item_id, author_auth_user_id)；取消爱心删除关系或记录撤销时间。作者、计数和排序均不得重复计同一账号对同一分享的爱心。

**content_view_events**

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| content_item_id | text | FK → content_items.id |
| viewer_key_hash | char(64) | 账号或匿名会话的短期 HMAC 标识；不保存原始 IP |
| view_day | date | Asia/Shanghai 展示日对应的去重桶 |
| viewed_at | timestamptz | 首次有效阅读时间 |

唯一约束 (content_item_id, viewer_key_hash, view_day)，避免重复刷新重复计数；过滤机器人和异常频率。公开显示可缓存的有效阅读总量；帖子活跃排序使用近期有效阅读、爱心和时间衰减，评论数只展示/留存，不进入帖子活跃分。密钥轮换与原始事件保留期限在部署前定值。

**content_comments**

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| content_item_id | text | FK → content_items.id |
| chapter_id | text | FK → chapters.id；必须与分享所属章节一致 |
| author_auth_user_id | text | 必填；登录用户 |
| body | text | 必填；MVP 纯文本单层评论 |
| status | enum | PUBLISHED / DELETED；作者可删除本人评论 |
| created_at, updated_at | timestamptz | 时间 |

索引 (content_item_id, status, created_at ASC)、(chapter_id, created_at DESC)、(author_auth_user_id, created_at DESC)。没有 parent_comment_id；不支持楼中楼或单条评论爱心。评论按时间顺序展示，MVP 不计算评论活跃分；公开评论仅能挂在公开分享下；分享隐藏/删除后评论对外不可读。服务端限长、频率限制及内容反馈入口是 MVP 必须项。

### 3.11 media_assets 与 content_media：媒体元数据与分享附件

**media_assets**

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| uploaded_by_auth_user_id | text | 上传账号 |
| storage_provider | varchar(80) | 实际 provider adapter 标识；Phase 0 决定，不写死供应商 |
| storage_namespace | varchar(160) | 道德经项目独立 bucket/container 别名，不含凭据 |
| object_key | varchar(700) | 对象存储键；UNIQUE (storage_namespace, object_key) |
| media_type | enum | IMAGE / AUDIO / VIDEO |
| mime_type | varchar(120) | 服务端检测得到的 MIME |
| byte_size | bigint | 上传字节数 |
| checksum_sha256 | char(64) | 可空；校验和/运维排查 |
| width, height | integer | 图片/视频元数据，可空 |
| duration_ms | bigint | 音视频时长，可空 |
| upload_status | enum | PENDING / READY / FAILED / DELETED |
| created_at, updated_at | timestamptz | 时间 |

**content_media**

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| content_item_id | text | FK → content_items.id |
| media_asset_id | text | FK → media_assets.id |
| sort_order | smallint | 同一分享附件顺序 |
| created_at | timestamptz | 关联时间 |

复合 PK (content_item_id, media_asset_id)；唯一约束 (content_item_id, sort_order)。媒体读取授权必须检查关联分享仍为 PUBLISHED 且媒体状态为 READY。隐藏或逻辑删除分享后，即使对象存储仍保留文件，也不能通过公开接口签发读取 URL。数据库不保存预签名 URL、原始文件内容或家谱项目存储凭据。媒体资源独立于家谱项目，复用技术/代码不等于共享服务实例、桶、账号或数据。

### 3.12 publication_acknowledgements：发布告知记录

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| content_item_id | text | FK → content_items.id |
| acknowledged_by_auth_user_id | text | 操作人账号 |
| notice_version | varchar(80) | 当时展示的公开范围/媒体授权提示版本 |
| scope | enum | PUBLIC_CONTENT / PUBLIC_MEDIA / THIRD_PARTY_RIGHTS_ATTESTATION |
| acknowledged_at | timestamptz | 确认时间 |
| revoked_at | timestamptz | 可空 |

每次发布前确认对应版本并追加记录；索引 (content_item_id, scope, acknowledged_at DESC)。允许撤回后重新确认新版本。该记录只证明上传者确认了平台告知/责任声明，不代表平台已验证所有可识别第三方的实际授权。第三方授权证据和投诉处理方式仍需政策/流程明确后再扩展字段。

### 3.13 audit_events：关键变更审计

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| actor_auth_user_id | text | 操作账号；系统任务可空并填 actor_type |
| actor_type | enum | USER / SYSTEM / OPERATOR |
| entity_type | varchar(80) | 如 GATHERING_SUBMISSION、TEMPORARY_PLACE、DOJO、CONTENT_ITEM |
| entity_id | text | 对象 ID |
| action | varchar(80) | 如 CREATE、CORRECT_LOCATION、HIDE、LOGICAL_DELETE |
| before_data, after_data | jsonb | 最小必要字段差异；禁止认证秘密/签名 URL |
| reason | varchar(500) | 可空 |
| request_id | varchar(100) | API 请求追踪 ID，可空 |
| created_at | timestamptz | 事件时间 |

索引 (entity_type, entity_id, created_at DESC)、(actor_auth_user_id, created_at DESC)。事件追加写，不做普通更新/删除；审计保留期限和账号删除后的数据处理需由隐私/运维策略单独定。

### 3.14 idempotency_records：提交请求幂等

| 字段 | 类型 | 约束 / 用途 |
| --- | --- | --- |
| id | text | PK |
| auth_user_id | text | 发起账号 |
| operation | varchar(100) | 如 GATHERING_SUBMISSION_CREATE、CONTENT_ITEM_CREATE |
| idempotency_key | varchar(160) | 客户端每次逻辑请求生成 |
| request_hash | char(64) | 服务端规范化请求摘要，防止同 key 不同内容 |
| resource_type | varchar(80) | 创建结果类型 |
| resource_id | text | 创建结果 ID |
| expires_at | timestamptz | 幂等窗口结束时间 |
| created_at | timestamptz | 时间 |

唯一约束 (auth_user_id, operation, idempotency_key)；清理过期键前应确保重试窗口满足产品要求。若复用成熟 API 幂等中间件，也可将该表替换为等效实现。

## 4. 未来 Agent Harness 持久化（不属于 MVP）

技术架构 Spec 明确 Agent Harness 不纳入当前 MVP 编码，AI 数据接入、平台内容索引及媒体 AI 处理均暂缓。下表只是未来工程自动化试点的最小持久化建议；不应与业务内容表混在同一个“AI 知识库”，也不包含 Evidence Snapshot、Derived Artifact 或向量表。

| 表 | 核心字段 | 对应模块 / 约束 |
| --- | --- | --- |
| harness_direction_versions | id, version, task_type, objective, allowed_tools JSONB, acceptance_criteria JSONB, prohibited_actions JSONB, checksum, created_by, created_at | 方向指引；不可变版本，不允许 Agent 自行改目标/权限 |
| harness_agent_versions | id, agent_key, version, runtime_config_ref, direction_version_id, judge_version_id, status, created_at | Agent/策略组合版本；活动版本由发布流程指定 |
| harness_judge_versions | id, version, rule_set_ref, eval_config_ref, hard_gates JSONB, checksum, created_at | 结果判定；安全硬门槛独立版本化 |
| harness_runs | id, agent_version_id, direction_version_id, principal_type, principal_id, task_type, status, repo_commit_sha, workspace_ref, started_at, finished_at, result_summary_redacted, error_code | 单次运行；不得存生产密钥或未经脱敏的完整代码/提示内容 |
| harness_run_events | id, run_id, sequence, stage, event_type, tool_name, status, metadata_redacted JSONB, created_at | 运行轨迹；UNIQUE(run_id, sequence)，事件追加写 |
| harness_resource_usage | id, run_id, resource_type, provider, quantity, unit, cost_microusd, limit_quantity, occurred_at | 资源边界；记录模型 token、工具调用、CPU/时间、网络等配额 |
| harness_error_cases | id, source_run_id, fingerprint, category, severity, summary_redacted, repro_ref, triage_status, created_at, resolved_at | 错误记录；复现数据需脱敏并受控访问 |
| harness_eval_suites | id, suite_key, version, dataset_ref, case_count, created_at | 版本化评测集；案例可放受控仓库数据文件，DB 存版本引用 |
| harness_eval_runs | id, suite_id, judge_version_id, candidate_commit_sha, baseline_commit_sha, status, started_at, finished_at, summary JSONB | 对候选变更运行评估 |
| harness_eval_results | id, eval_run_id, case_key, outcome, scores JSONB, failure_reason, created_at | 每个案例判定；UNIQUE(eval_run_id, case_key) |
| harness_change_proposals | id, title, change_summary, source_run_id, candidate_commit_sha, baseline_commit_sha, eval_run_id, status, reviewer_id, reviewed_at, merged_commit_sha, rollback_ref, created_at | 自进化提案；Agent 只创建候选，不自动改 Judge 门槛/权限或合并发布 |
| harness_feedback | id, run_id, reviewer_id, feedback_type, comment_redacted, created_at | 人工反馈；反馈不自动等同于正确标签 |

Harness MVP 若尚未实现，不创建这些表。试点阶段可把本组表放独立 PostgreSQL schema 或独立数据库；选择前须确认数据保留、工程代码是否含敏感信息、模型供应商处理边界和运维成本。不得让这些表存储未经批准的平台分享、媒体内容或 AI 派生索引。

## 5. Prisma 与迁移约定

- 领域 schema 不复制 auth-kit 拥有的认证表字段。
- Profile/内容/活动表引用稳定 auth_user_id。若 auth-kit 与领域 schema 在同一 Neon 数据库且迁移可共同管理，优先加数据库 FK；若认证模块保持独立迁移边界，则通过登录用户 hook 保证 Profile 存在，并加 orphan 检查任务，不能为了 ORM 关系复制认证数据。
- PostgreSQL 约束优先用 NOT NULL、UNIQUE、FK、check constraints；Prisma 不支持表达的条件唯一索引/跨表不变量用受控 SQL migration。
- 删除规则：章节版本、道场、用户内容优先 RESTRICT 或软删除；内容附件删除不应误删被引用资产；清理媒体对象先撤销公开读取，再由运维流程删除对象并记录结果。
- 公开查询默认使用显式 repository/service 方法并强制过滤 status = PUBLISHED/ACTIVE；不依赖客户端过滤。
- 复杂审计 JSON 只存差异必要字段；搜索索引、地图 provider payload、签名 URL、验证码、密码及大媒体内容不入业务表。

## 6. 必要索引与查询路径

| 用途 | 建议索引 |
| --- | --- |
| 阅读目录 | chapters(number) UNIQUE；chapter_texts(edition_id, chapter_id) UNIQUE |
| 章节频道分享列表 | content_items(chapter_id, status, published_at DESC) |
| 本人分享/共读 | author/submitter_auth_user_id, status, created_at DESC |
| 固定道场地图/省市列表 | dojos(status, province_code, city_code, name)；坐标查询索引 |
| 本人道场维护列表 | dojos(maintainer_auth_user_id, status, name) |
| 活动记录关联 | gathering_submissions(chapter_id, submitted_at DESC)、(dojo_id, submitted_at DESC) |
| 媒体附件读取 | content_media(content_item_id, sort_order) |
| 审计历史 | audit_events(entity_type, entity_id, created_at DESC) |
| 幂等检查 | idempotency_records(auth_user_id, operation, idempotency_key) UNIQUE |

首期搜索为后续候选，不预建向量索引。数据库全文索引待实现计划中明确搜索需求后再加。

## 7. 尚需产品/技术决策

1. **活动记录默认可见性**：MVP 活动提交记录默认公开；公开 API 只返回提交人基础名称/头像、领读人、章节、分钟级提交时间及必要地点信息，不返回认证凭据或联系方式。
2. **临时地点坐标的公开粒度**：实施计划要求保存定位坐标和街道地址，产品要求街道级公开。建议 DB 内坐标只供受控地点/导航服务使用，公开 API 只回街道级地址；需确认坐标是否允许用于外部导航或直接公开。
3. **同一固定道场的维护权交接**：MVP 仅 creator/maintainer ID，不建转移历史/合并工作流；若需要管理员接管，应增加授权审计行为。
4. **第三方媒体授权凭证**：发布告知记录可证明上传者确认提示，但不能证明每位入镜/入声者实际同意。当前字段不应伪装成完整证据管理；上线媒体功能前需明确如何获得、撤回与审核第三方授权。
5. **Auth Kit migration 边界**：确认 auth 表与业务表是否同一 Neon 数据库、由谁负责迁移，以及领域 auth_user_id 能否加物理 FK。
6. **数据库软删除与账号删除**：账号删除不属于 auth-kit 首期保证范围；需在持久化数据上线前确定个人内容、媒体对象和审计记录的保留/匿名化策略。

## 8. MVP 实体清单

首期建议顺序：user_profiles / avatar_presets → chapters / text_editions / chapter_texts / chapter_materials / chapter_channels → dojos → gathering_submissions / temporary_places → content_items / content_likes / content_view_events / content_comments / media_assets / content_media / publication_acknowledgements → audit_events / idempotency_records。

不属于当前 MVP：后续活动主体及参与模型（`GatheringEvent`、`EventParticipant`、`EventGroup` / `EventGroupMember`）、活动报名/签到、录音会话、说话人片段和认领收获表、地点归并关系、话题/楼中楼评论/关注、跨章节推荐曝光表、AI 内容摄取/检索/派生表，以及第 4 节 Agent Harness 表。活动实体和音频认领边界见[线下共修流程与自愿记录概念 Spec](./offline-gathering-capture-concept-spec.md)；未来实施不得将报名/签到视为录音或公开授权。
