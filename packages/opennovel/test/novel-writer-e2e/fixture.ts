/**
 * 技法 agent 流程 e2e 夹具：合成测试小说 + 状态快照。
 *
 * 三章素材人工设计：第 1 章对话机制、第 2 章描写技法、第 3 章节奏/过渡，
 * 每章带唯一锚点片段（青瓷茶杯 / 青石板路 / 三年前的雨夜），
 * 供假 LLM 脚本按请求内容匹配分轮响应。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { eq } from "drizzle-orm"
import { ChapterTable, getDb, NovelTable, TechniqueFeedbackTable, TechniqueShadowLogTable, TechniqueTable } from "@opennovel-ai/novel-store"

/** 与 packages/plugin/test/novel-writer/technique-test-env.ts 同款：调用方须在测试文件模块顶层先调用。 */
export function installFreshGlobalDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "technique-global-e2e-"))
  process.env.OPENNOVEL_TECHNIQUE_DB = join(dir, "techniques.db")
  return process.env.OPENNOVEL_TECHNIQUE_DB
}

const CHAPTER_1_DIALOGUE = `第1章 茶馆夜谈

城南的"听雨轩"茶馆过了戌时就没什么客人了，只剩角落里的两张桌子还亮着灯。

"掌柜的，再来一壶碧螺春。"周慕云把青瓷茶杯轻轻放下，杯底与檀木桌面碰出一声几不可闻的脆响。

柜台后的老者抬了抬眼皮："客官，茶可以续，话要想好再说。"

"我想得很清楚了。"周慕云从怀里取出一张泛黄的契纸，推到桌子中央，"三百两，这是底价。掌柜的在这行当里摸爬滚打三十年，应该看得出来，这纸上的东西值多少。"

老者没有立刻伸手，只是用抹布慢条斯理地擦着手里另一只杯子："周公子，老朽开的是茶馆，不是当铺。您这东西烫手，老朽接不住。"

"接不住，还是不敢接？"周慕云的声音不高，却像一根针，精准地扎进了对方话语里的缝隙。

老者擦杯子的手停了半拍。他抬起头，第一次正眼打量这个年轻人："您父亲当年坐的就是您这个位置，说的话也跟您一模一样。"

"所以他死了。"周慕云面不改色，"掌柜的，我不想重复他的路。我来，是想买一条不重复的路。"

茶馆里静了下来，只有炉上的水壶发出细微的呜咽。老者盯着那张契纸看了很久，久到周慕云以为自己又要白跑一趟，老者才缓缓开口："三百两，老朽拿不出。但是老朽可以告诉您，三年前那个雨夜，先走的不是您父亲的人。"

"是谁？"

"是您父亲自己。"老者把擦好的杯子倒扣在案上，"他本可以走的。他选择留下来，把东西藏好，然后把追兵引去了码头。"

周慕云的手指收紧了。三年来他第一次听到一个完全不同的版本——不是背叛，不是失误，而是一个父亲用命换下来的局。

"契纸您收回去。"老者站起身，开始上门板，"今夜老朽什么都没说过。公子要查，就顺着码头往下查，查到哪儿算哪儿。"

"为什么帮我？"

老者背对着他，声音从门板后面闷闷地传出来："因为您喝茶的样子，像您父亲。父子俩连捏杯子的手势都一个样——食指先落，拇指后扣。"

周慕云低头看自己的手，一时间竟说不出话来。`

const CHAPTER_2_DESCRIPTION = `第2章 雾中市集

天还没亮透，山城的雾就先醒了。

它从江面上升起来，漫过堤岸，漫过吊脚楼的木桩，漫进一条条青石板路铺就的巷道。石板被夜里的潮气泡得发亮，像一条条泡在水里的鱼脊背，弯弯曲曲地伸向雾深处。

沈青梧背着竹篓走在雾中，草鞋踩在石板上，发出"啪嗒、啪嗒"的轻响。她走得不快——不是不想快，是这雾里的市集讲究个"早"字：摊子还没支起来，买卖双方先得把一天的规矩定下来。

"青梧丫头，又来这么早。"雾气里转出一个人影，是卖豆腐的老陈。他的担子两头挑着，前头是还冒着热气的豆腐屉子，后头是一摞摞码得整整齐齐的粗瓷碗。"你娘的药，我让你婶子给你留了两服，在摊子后头的瓦罐里煨着。"

"陈伯，多少钱？"

"提什么钱。"老陈把担子往墙根一放，从屉子里切下一块嫩豆腐，用芭蕉叶托着递过来，"先垫垫。你们母女俩守着一个药铺，半个镇子的人都欠着你们的恩情，两服药还记账，传出去我老陈还要不要脸面。"

沈青梧接过豆腐，指尖触到芭蕉叶的凉意，心里却是热的。她道了谢，继续往市集深处走。

雾渐渐薄了。各家摊子次第亮起灯来：卖山货的、卖竹器的、卖熏腊的……吆喝声此起彼伏，和江上传来的第一声汽笛搅在一起，把整座山城从睡梦里彻底拽了出来。

沈青梧在自家药铺门口停下。门板的漆已经斑驳，门楣上"沈氏药铺"四个字的匾额却还擦得锃亮——那是她爹生前最在意的东西。她从怀里摸出钥匙，插进铜锁，手腕一拧，"咔哒"一声，一天的营生就这样开了头。`

const CHAPTER_3_PACING = `第3章 旧案重提

时间倒回三年前的雨夜。

码头的雨比市区更急，豆大的雨点砸在铁皮棚上，噼里啪啦响成一片。周远之——周慕云的父亲——把最后一只皮箱塞进货舱的夹层，转身对身边的人说："东西分三份，码头的这一份是假的。"

"老爷，那真的呢？"

"真的在我该在的地方。"周远之抹了一把脸上的雨水，声音沉稳得不像一个正在逃命的人，"记住，今晚的事，出了这个码头就烂在肚子里。谁问起来，都说我往东去了。"

"那您……"

"我自有去处。"

后来的事情，卷宗上记得很清楚：当夜码头发生了械斗，周远之"死于乱中"，凶手"下落不明"。案子结了三年，卷宗上积了三年灰，周家从城里搬了出去，知情的人一个接一个地沉默下去。

——而现在，三年后的这个清晨，周慕云坐在听雨轩里，指尖捏着那张父亲留下的契纸，第一次意识到：卷宗上写的是"东去"，老者说的是"他本可以走"。两条线索之间，隔着一个被所有人刻意忘记的角落。

他付了茶钱，起身走出茶馆。雾还没散尽，街角的报童正在叫卖晨报。周慕云买了一份，展开，三版下方的一则小广告映入眼帘：

"本埠沈氏药铺，即日起重金收购各类药材，量大从优。"

他的目光在"沈氏"两个字上停住了。父亲留下的契纸背面，有一行极淡的钢笔字，淡得几乎看不出来——"若有不测，去找沈家"。`

export const TEST_CHAPTERS = [
  { title: "第1章 茶馆夜谈", content: CHAPTER_1_DIALOGUE },
  { title: "第2章 雾中市集", content: CHAPTER_2_DESCRIPTION },
  { title: "第3章 旧案重提", content: CHAPTER_3_PACING },
]

/** 每章唯一锚点片段，假 LLM 分轮匹配与断言用。 */
export const CHAPTER_ANCHORS = ["青瓷茶杯", "青石板路", "三年前的雨夜"]

export type TestNovel = {
  novelId: string
  chapters: Array<{ id: string; title: string; order: number }>
}

export function buildTestNovel(dir: string, opts?: { techniqueInjection?: boolean }): TestNovel {
  mkdirSync(join(dir, ".novel"), { recursive: true })
  const db = getDb(dir)
  const novelId = crypto.randomUUID()
  db.insert(NovelTable).values({ id: novelId, title: "技法e2e测试书", genre: "都市", synopsis: "技法学习流程测试用书" }).run()
  const now = Date.now()
  const chapters = TEST_CHAPTERS.map((ch, i) => {
    const id = crypto.randomUUID()
    db.insert(ChapterTable)
      .values({
        id,
        novel_id: novelId,
        volume_id: null,
        title: ch.title,
        order: i + 1,
        content: ch.content,
        word_count: ch.content.length,
        status: "draft",
        outline: "",
        created_at: now,
        updated_at: now,
      })
      .run()
    return { id, title: ch.title, order: i + 1 }
  })
  if (opts?.techniqueInjection !== undefined) {
    writeFileSync(join(dir, ".novel", "config.json"), JSON.stringify({ technique_injection: opts.techniqueInjection }))
  }
  return { novelId, chapters }
}

export type TechniqueRowSnapshot = {
  id: string
  name: string
  status: string
  confidence: number
  scope: string
  level: string
  usageCount: number
  evidenceCount: number
}

export type DbSnapshot = {
  techniqueCount: number
  feedbackCount: number
  techniques: TechniqueRowSnapshot[]
}

export function dbSnapshot(dir: string): DbSnapshot {
  const db = getDb(dir)
  const techniques = db.select().from(TechniqueTable).all()
  const feedback = db.select().from(TechniqueFeedbackTable).all()
  return {
    techniqueCount: techniques.length,
    feedbackCount: feedback.length,
    techniques: techniques.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      confidence: t.confidence,
      scope: t.scope,
      level: t.level,
      usageCount: t.usage_count,
      evidenceCount: (JSON.parse(t.evidence || "[]") as unknown[]).length,
    })),
  }
}

/** 直查本书库章节（绕过插件层，夹具自检用）。 */
export function chapterCount(dir: string): number {
  const db = getDb(dir)
  return db.select().from(ChapterTable).all().length
}

export { eq }
/** 直查本书库指定序号的章节正文（绕过插件层，写作落库断言用）。 */
export function chapterContent(dir: string, order: number): string {
  const db = getDb(dir)
  const [row] = db.select({ content: ChapterTable.content }).from(ChapterTable).where(eq(ChapterTable.order, order)).limit(1).all()
  return row?.content ?? ""
}
/** 直查技法检索 shadow log（召回候选留痕断言用）。 */
export function shadowLogRows(dir: string): Array<{ retrievedTechniqueIds: string[]; retrievedTechniqueNames: string[] }> {
  const db = getDb(dir)
  return db
    .select()
    .from(TechniqueShadowLogTable)
    .all()
    .map((r) => ({ retrievedTechniqueIds: JSON.parse(r.retrieved_technique_ids) as string[], retrievedTechniqueNames: JSON.parse(r.retrieved_technique_names) as string[] }))
}

/**
 * 续写正文：原创场景 prose，≥2500 汉字（默认目标字数下限），
 * 无"第N章/N卷"坐标、无提纲标签，不照抄任何既有章节原文。
 * learn-chapter 与 recall-eval 的 write_chapter 载荷共用。
 */
export const REWRITE_CONTENT = `周慕云把契纸收进怀里，推开了听雨轩的木门。

晨雾正浓。街道两侧的铺子才卸下第一块门板，蒸笼的白汽混在雾里没有边界。他站在台阶上停了一会儿，听身后茶馆里传出的细碎响动——老者在收拾茶具，动作很轻，像是怕惊动了什么。

他没有回头。问了三年，这是第一次有人肯把话说到那个雨夜的边上。边上一寸，就是真相一丈。周慕云把领口拢了拢，走进雾里。

街角的早点摊已经生了火。老板娘认得他这三年的脸，照例舀了一碗豆花，没问话。周慕云端着碗，热气熏在脸上，心里却把老者那句话翻来覆去地掂：先走的不是你的人，是你父亲自己。

这是什么意思？卷宗上写得明白：当夜码头械斗，父亲死于乱中，凶手下落不明。若是先走的不是人，那便是说——械斗之前，父亲就已经离开了码头？可尸身分明是在码头下游捞起来的，官府验过，仵作画过押。

除非……捞起来的那个人，从一开始就不是父亲。

这个念头一冒出来，周慕云的手指头就凉了。他想起契纸背面那行淡得几乎看不见的钢笔字：若有不测，去找沈家。三年来他托人查过城里城外的沈姓人家，名册抄了整整两页，没有一家与父亲生前有过往来。可如果方向从一开始就错了呢？如果沈家根本不在城里，而在别处——在父亲最后出没的码头沿线？

他三口两口扒完豆花，放下两枚铜板，起身往江边走。

雾里的江堤空无一人。拴缆桩上挂着水珠，一艘货船正离岸，汽笛声闷闷地压在水面上。周慕云沿着堤往前走，一路数着桩号。父亲当夜是从七号桩附近下的水——卷宗上是这么写的。他在七号桩前蹲下来，拨开桩基边的乱草。

草里有东西。

那不是三年前的东西——太新了，是一块被人踩进泥里的布条，靛青色，边缘绣着半朵缠枝莲。周慕云的心跳漏了一拍。这种绣样他见过，在母亲留下的旧箱底，压在父亲年轻时的袍角上。周家没有人认得这种绣样出自哪家绣庄，母亲生前只说，那是父亲从外面带回来的。

外面。哪个外面？

布条入手微沉，边缘的针脚细得不像寻常绣庄的手艺。周慕云见过苏绣的密、见过蜀锦的艳，这半朵缠枝莲却是另一种路数——配色极克制，只在花蕊处点了一星暗红，像是某种记号，而不是装饰。他想起父亲书房里那幅常年卷着的山水立轴，画上没有题款，只有角落里一枚指甲盖大小的印章，印文早已磨得只剩半边。若这绣样与那印章出自同一路数，那么父亲生前所说的外面，便不止是一个方向，而是一整张他从未见过的网。

他把布条贴身收好，站起身。雾已经开始散了，江对岸的山影渐渐出来，一层淡过一层，像有人在水墨画上慢慢收笔。他忽然意识到，自己这三年的查法全都错了——他一直在城里找凶手，可父亲把线索留在了江边，留在了外面。

沿着江堤再往前，是废弃的盐仓。仓门上挂着锈锁，锁梁上却有一道新磨出来的亮痕——三个月内有人开过这把锁。周慕云没有钥匙，也不打算现在进去。他从门缝里望进去，尘土很厚，只有靠窗的一小块地面干净得出奇，像是有人站在那里掸过一张纸，或者看过一张图。窗台上落着一点烟灰，细而白，是上等烟丝烧尽的样子。父亲生前不抽烟，但替他整理遗物时，周慕云在书房的笔洗里见过同样的灰。

有人在替他查。或者，有人在引着他查。这两个念头都不算暖和，但比起三年前那种四处碰壁的冷，至少此刻他知道该往哪儿走。

他沿着江堤继续往前走，雾在脚边打着旋。经过九号桩时，一个披蓑衣的老船夫正在系缆，见他一路盯着桩号看，咧嘴笑了笑：公子是头一回来这段堤吧？这桩子啊，三年前五根断过两根，后来补上的新桩，号牌子都钉反过。

断过？周慕云停下脚步。老船夫却不肯再多说，摆摆手钻进船篷里去了，只留下缆绳上滴滴答答的水声。

周慕云站在原地，把这半日里得来的碎片一样一样摆开：老者说父亲本可以走；卷宗写父亲死于乱中；布条绣着不属于城里任何一家绣庄的缠枝莲；九号桩断过又补上；盐仓里有人替他看过什么。这几样东西之间一定有一根线，他暂时还看不见那根线，但他已经摸到了线头。

他抬起头，江面尽头的雾正在退。退尽之后，未必是晴天，但总会露出河床本来的样子。周慕云把布条贴身收好，沿着堤往城里走。他知道接下来该做什么：先查绣样，再查沈家，最后——回到码头，把三年前的那个雨夜，一寸一寸地重新走一遍。

雾散尽之前，他的身影已经消失在江堤的尽头。
出了巷子，城门洞下的风比街上硬。守门的兵丁换了一茬，谁都不认得他，例行盘查之后才放行。周慕云站在门洞里回头看了一眼这座他住了半辈子的城——青灰色的城墙，墙头枯黄的草，一切都和三年前一样，一切又都不一样了。那时他以为查清父亲的案子，靠的是银子和耐心；现在他才明白，靠的是有人肯在戌时之后还为他亮着一盏灯。

他忽然想起父亲生前的账房周先生。老人前年告老还乡，走之前曾欲言又止地塞给他半页纸，纸上只有一行字：公子要问的事，一半在卷宗里，一半在卷宗外。他当时不懂，以为是老人打机锋。如今想来，卷宗里的是死的，卷宗外的才是活的——老者、船夫、布条、盐仓，哪一个都不在卷宗里。

午时前后，他回了城，没有直接回家，而是绕去了县衙后街的档房。档房的差役认得周家的名帖，客气地告诉他：三年前的码头案卷宗已经封存，调阅须得太守的手令。周慕云也不纠缠，笑着道了谢，转身时目光扫过档房门口那棵老槐树——树皮的纹路里，有一道新鲜的刻痕，刻的是半个莲花瓣。

他的脚步没有停，心却猛地沉了下去。缠枝莲。又是缠枝莲。城里有一双眼睛在看着他查案，而且那双眼睛并不打算躲——它一路留下记号，像是引路，又像是考校。引路的人知道答案，考校的人想知道他配不配拿到答案。周慕云忽然不急着找沈家了。他先要知道，这双眼睛是敌是友。

回到周府旧宅时，日头已经偏西。宅子卖了两年，门上的漆剥落了大半，唯有门环还是父亲当年亲手换的那一对铜环。他在门前站了片刻，没有进去，只在心里把今天的路重新走了一遍：听雨轩的老者、江堤的布条、九号桩、盐仓、档房的刻痕。这些线索像一把散落的珠子，要串起它们，还差一根线——而线的一端，多半就系在那个他从未谋面的沈家身上。

他最后看了一眼老屋的门楣，转身走进暮色里。三年都等了，不急在这一晚。但从明天起，每一个城门、每一艘渡船、每一家绣庄，他都会亲自去问。
是夜，周慕云在客栈要了间临街的房，把白日所得一样样摊在桌上：布条、半页旧纸、他自己描下的桩号图。烛火跳了跳，他忽然注意到布条的背面——靛青染料之下，隐约有一行极小的字迹，得对着光斜着看才辨得出。他屏住呼吸，把布条凑到烛前。

那不是字，是一串数字：三七、九四、一一。三个数，两个顿号，墨色沉在纤维里，至少写了有些年头。

三七……九四……周慕云的手指在桌上轻轻叩着。若说是日期，对不上任何节气；若说是桩号，江堤上没有九十四号桩。他忽然想起父亲书房里那套从来没人翻过的《水经注》，书脊的签条上，父亲用蝇头小楷标过页码——第三册第七页，第九册第四页。他从未在意过，只当是父亲的读书习惯。

原来习惯也会说话。死人留下的习惯，说得比活人还清楚。

他把布条收进贴身的锦囊，吹熄了烛火。黑暗里，江声隐隐传来，一下一下，像有人在很远的码头上，敲门。
他对着黑暗坐了很久，直到梆子声敲过三更。窗外的更鼓声，一声远过一声。`

/**
 * 每用例独占书库连接。opennovel 测试进程在 preload.ts 把 OPENNOVEL_DB 钉为 ":memory:"，
 * getDb(directory) 优先读 env，默认全进程共享一块内存库——跨文件跑时 learn-book 的入库
 * 会渗进后续用例。这里把 env 指到本用例 tmpdir 的真实库文件，返回还原函数（先例：
 * plugin 包 technique 测试逐文件设置 OPENNOVEL_DB）。
 */
export function useIsolatedBookDb(dir: string): () => void {
  const previous = process.env.OPENNOVEL_DB
  process.env.OPENNOVEL_DB = join(dir, ".novel", "novel.db")
  return () => {
    if (previous === undefined) delete process.env.OPENNOVEL_DB
    else process.env.OPENNOVEL_DB = previous
  }
}