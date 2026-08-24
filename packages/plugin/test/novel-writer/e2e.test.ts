/**
 * 小说写作完整流水线 E2E 测试
 *
 * 测试 init→book→outline→ch1→audit→approve→ch2 的完整端到端流程。
 * 使用合成数据，不依赖真实 LLM 调用。
 * 使用临时 SQLite 数据库，测试结束后自动清理。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
// @ts-ignore - bun:sqlite 类型仅在 bun 运行时可用
import { Database as BunSqlite } from "bun:sqlite"

// DB 路径必须在模块导入前设置，因为各模块的 getDb() 在首次调用时读取该环境变量
const testDir = join(tmpdir(), `novel-writer-e2e-${Date.now()}`)
const dbPath = join(testDir, "test.db")
const projectDir = join(testDir, "novel-project")
const originalOpenNovelDb = process.env.OPENNOVEL_DB
process.env.OPENNOVEL_DB = dbPath
mkdirSync(testDir, { recursive: true })

// 所有模块导入
import { initNovelProject, createBook } from "../../src/novel-writer/cli.js"
import { generateMasterOutline, generateVolumeOutline, generateChapterOutline } from "../../src/novel-writer/outline.js"

import { assembleSnapshot } from "../../src/novel-writer/context.js"
import { requestApproval, handleApproval } from "../../src/novel-writer/approval-gate.js"
import { checkContinuity } from "../../src/novel-writer/continuity-check.js"
import { commitState } from "../../src/novel-writer/state-commit.js"
import { chapterWrite } from "../../src/novel-writer/chapter-tools.js"
import { closeDb } from "@opennovel-ai/novel-store"

// 合成章节内容（2000+ 中文字符，满足 chapterWrite 的字数验证）
const CHAPTER_1_CONTENT = `第1章 陨落的天才

清晨的第一缕阳光透过破旧的窗棂洒进小屋，照在林天那苍白而坚毅的脸庞上。

他缓缓睁开双眼，感受着体内那股微弱到几乎无法察觉的灵力波动，嘴角泛起一丝苦涩的笑容。曾几何时，他是青云宗最耀眼的天才，十六岁便已踏入筑基境，被所有人视为百年难遇的修炼奇才。然而，那场突如其来的变故改变了一切。

两年前的那个雨夜，林天永远无法忘记。他在后山修炼时，遭遇了神秘的黑衣人袭击。对方实力远超于他，一掌便震碎了他的灵脉，将他从云端打落凡尘。从那以后，他体内的灵力如涓涓细流般不断流失，修为从筑基境一路跌落到炼气一层，甚至还在持续衰退。

"天哥，你醒了？"门外传来一个清脆的声音，打断了林天的思绪。

一个穿着淡绿色长裙的少女推门而入，手中端着一碗热气腾腾的灵药。她是苏婉清，林天的青梅竹马，也是青云宗内少数几个在他落魄后仍然不离不弃的人。

"婉清，你又去药堂求药了？"林天看着少女额头上细密的汗珠，心中涌起一股暖流。

苏婉清将药碗放在床头的小桌上，轻声说道："这是我从药堂长老那里求来的固本培元汤，虽然不能修复你的灵脉，但至少能帮你稳固住现有的灵力，不再继续衰退。"

林天摇了摇头："婉清，你不用再为我费心了。我知道自己的情况，灵脉尽碎，已是废人一个。你再这样帮我，只会连累你在宗门中的地位。"

"不许你这么说！"苏婉清的眼眶微微泛红，"我相信你一定能重新站起来。你可是林天啊，那个曾经让整个青云宗都为之骄傲的林天！"

林天沉默了片刻，伸手端起药碗一饮而尽。苦涩的药液顺着喉咙滑下，但更苦的是心中的不甘。

就在这时，门外传来一阵嘈杂的脚步声。

"哟，我们的天才还在喝药呢？"一个阴阳怪气的声音响起，紧接着，三个身穿青云宗弟子服的年轻人走进了小屋。

为首的那人名叫赵峰，是青云宗内门弟子，筑基三层的修为。他曾经是林天的手下败将，在宗门的年度大比中被林天三招击败。如今林天落魄，他便成了最热衷于落井下石的人。

"赵峰，你来做什么？这里不欢迎你！"苏婉清站起身，挡在林天面前。

赵峰嗤笑一声："苏师妹，你何必护着这个废物？他现在连炼气一层的修为都保不住，过不了多久就会被逐出宗门。你不如趁早离他远点，免得被牵连。"

"你——"苏婉清气得浑身发抖。

林天伸手按住苏婉清的肩膀，缓缓站起身，平静地看着赵峰："赵峰，如果你是来看笑话的，现在看够了，可以走了。"

赵峰眯起眼睛，上下打量着林天，嘴角勾起一抹嘲讽的弧度："林天，你知道吗？三个月后就是宗门年度大比。按照规矩，所有弟子都必须参加。到时候，我会当着全宗的面，让你知道什么叫天壤之别。当然，如果你怕了，现在就可以去找长老申请退出。"

"不必了。"林天的声音很平静，但眼中却闪过一丝奇异的光芒，"三个月后，我会准时参加大比。"

赵峰愣了一下，随即哈哈大笑起来："好！有骨气！那我就等着看你三个月后怎么在全宗面前出丑！"

说完，他带着两个跟班扬长而去。

苏婉清焦急地看着林天："天哥，你疯了吗？你现在的情况，怎么可能参加大比？"

林天没有回答，只是缓缓抬起右手。在他的掌心，一团微弱到几乎肉眼难辨的光芒正在缓缓凝聚。那是他体内最后一丝灵力，微弱得如同风中残烛，随时可能熄灭。

但就在这团光芒的最深处，有一个极其隐秘的符文正在缓缓旋转。那是在那次袭击中，黑衣人打入他体内的东西不是纯粹的破坏，而是一道封印。封印之下，隐藏着某种他至今都无法理解的力量。

这三个月，林天数次感觉到那股力量在蠢蠢欲动。每当他的灵力衰退到极限时，封印就会出现一丝松动，从缝隙中溢出的力量每次都会让他的身体产生一阵剧烈的震颤。

他有预感，三个月后，当封印彻底破碎的那一刻，将会发生某种改变命运的事情。

"三个月，足够了。"林天低声说道，目光望向窗外远处的青云山脉。那里的云雾深处，据说隐藏着上古大能的修炼洞府，无数至宝和传承等待着有缘人。

苏婉清看着林天坚毅的侧脸，心中涌起一股莫名的信心。她认识林天这么多年，从未见过他露出这种表情那不是绝望，而是某种隐忍的期待。

"我相信你。"苏婉清轻声说道，握紧了手中的药碗。

窗外，朝阳已经完全升起，将金色的光芒洒满了整个青云山脉。远处传来弟子们晨练的呼喝声，新的一天开始了，而属于林天的故事，也才刚刚拉开序幕。

林天闭上眼睛，感受着体内那道封印的微弱脉动。三个月的时间，足够他找到破解之法。他曾是青云宗的天才，即使灵脉尽碎，那颗不屈的心也从未熄灭。

"赵峰，三个月后，我会让你知道，什么是真正的天才。"他在心中默默说道。

阳光渐渐变得明亮炽热，将小屋内的阴暗一扫而空。林天从床上站起，走向窗边，推开那扇已经有些松动的木窗。清新的空气涌入屋内，带着后山药田里灵草的淡淡清香。

他深吸一口气，感受着体内那道封印的微弱震颤。虽然灵脉已碎，但他的精神力和意志力从未减弱。这三个月，他要利用一切可以利用的资源，找到破解封印的方法，重新踏上修炼之路。

窗外，苏婉清已经走远，她的背影在晨光中显得格外纤细而坚定。林天知道，在这个冷漠的宗门里，只有她是真正关心自己的人。为了她，为了自己，他必须重新站起来，必须让那些曾经嘲笑他、轻视他的人看到，什么才是真正的天才。`

// 第二章合成内容
const CHAPTER_2_CONTENT = `第2章 封印碎裂

三个月的时间转瞬即逝。

青云宗的演武场上，人声鼎沸。年度大比是宗门最重要的盛事，几乎所有弟子都会前来参加或观战。宽阔的演武场中央，三十六座比武台一字排开，每座台上都布有防御阵法，防止战斗余波伤及观众。

林天站在演武场的边缘，身边只有苏婉清一人陪伴。周围不时投来异样的目光和窃窃私语。

"那不是林天吗？他居然真敢来参加大比？"

"听说他现在的修为连炼气一层都快保不住了，这不是自取其辱吗？"

"唉，曾经的天才，如今沦落到这种地步，真是可惜。"

苏婉清握紧了林天的手，低声说道："别在意他们说什么。"

林天微微一笑："我没事。"

他的目光落在远处的一座比武台上，赵峰正站在那里，双臂抱胸，一脸得意地看着他。按照抽签结果，林天的第一个对手，正是赵峰。

"第一轮，第三十七场，林天对赵峰！"

随着裁判长老的声音响起，全场一片哗然。所有人都知道两人之间的恩怨，这无疑是一场毫无悬念的对决。

赵峰率先跳上比武台，双手结印，周身灵力涌动，筑基三层的威压毫无保留地释放出来。台下响起了阵阵惊呼。

"好强的灵力波动！赵师兄的修为似乎又精进了！"

"这种实力，林天怎么可能打得过？"

林天缓步走上比武台，面不改色。他的步伐很稳，每一步都踩得坚实有力，完全不像是灵力衰退的废人。

"林天，你还真敢来。"赵峰冷笑道，"我劝你趁早认输，免得在这么多人面前丢脸。"

"废话少说，开始吧。"林天的声音很平静，如同深潭止水。

赵峰眼中闪过一丝怒意："既然你找死，那就别怪我不客气！"

话音刚落，赵峰双手猛然推出，一道凌厉的掌风呼啸而出，裹挟着炽热的灵力，直奔林天面门而去。这一掌，他用了八成力道，显然是打算一击制敌，狠狠羞辱林天。

台下众人纷纷摇头，苏婉清更是紧张地闭上了眼睛。

然而，就在掌风即将击中林天的瞬间，异变突生！

林天的体内，那枚沉寂了整整两年的封印符文突然剧烈震颤起来。紧接着，一道刺目的金光从他体内迸射而出，将整个比武台都笼罩在一片耀眼的光芒之中。

"什么？！"赵峰脸色大变，他感觉到一股无法形容的恐怖威压从林天身上爆发出来，那股力量远远超出了筑基境的范畴，甚至让他这个筑基三层的高手都感到灵魂在颤栗。

光芒散去，林天缓缓抬起头。他的双瞳之中，隐隐约约浮现出一枚古老的符文印记。那是封印彻底破碎后留下的痕迹，也是某种远古传承觉醒的标志。

"这就是你当初打入我体内的东西么？"林天喃喃自语，感受着体内那股汹涌澎湃的力量。那不是灵力，而是一种更加古老、更加纯粹的能量混沌之力。

赵峰咬紧牙关，再次催动全部灵力，拼尽全力轰出一拳："我不信！你一个废物，怎么可能突然变得这么强！"

林天轻轻抬起右手，伸出一根手指，轻轻一点。

轰！

一股无形的力量如同惊涛骇浪般席卷而出，赵峰的拳劲在接触到这股力量的瞬间便土崩瓦解，整个人如同断线的风筝般倒飞出去，重重地撞在防御阵法的光幕上，口中鲜血狂喷。

全场死寂。

所有人都目瞪口呆地看着这一幕，就连高台上的长老们都纷纷站起身，眼中满是不敢置信。

"这、这是金丹境的威压？！"一位白发长老失声惊呼。

"不，不对，这不是金丹境的力量。这种力量，老夫从未见过"

林天缓缓收回手指，看着倒在地上的赵峰，语气平静地说道："我说过，三个月后，我会来参加大比。现在，你还有什么想说的？"

赵峰脸色惨白，嘴唇哆嗦着，却一个字也说不出来。他无论如何也想不通，一个灵脉尽碎的废物，怎么会在短短三个月内变得如此强大。

"第一轮，第三十七场，林天胜！"

裁判长老的声音将所有人从震惊中拉回现实。演武场上爆发出雷鸣般的议论声，所有人都在猜测林天身上到底发生了什么。

苏婉清激动得热泪盈眶，她冲到台边，紧紧抱住了走下来的林天。

"我就知道，我就知道你一定可以！"

林天轻轻拍了拍她的背，目光却投向远方的青云山脉深处。那里，有一处上古洞府，封印破碎后，他脑海中多出了一段记忆那是属于远古大能的残缺传承，指引着他去往那个地方。

在那里，或许能找到他真正想要的答案。混沌之力已经觉醒，接下来要做的，就是修炼、变强，然后揭开那个两年前雨夜背后的真相。

"等着吧，那个黑衣人，不管你是谁，我林天一定会找到你。"他在心中立下誓言。

远处，苏婉清的父亲苏长老站在高台上，望着林天的背影，眼中闪过一丝复杂的神色。他比任何人都清楚，林天的灵脉是如何被毁的，也知道那个雨夜的真相。

"该来的，终究还是来了。"苏长老低声自语，转身离开了比武场。

夜幕降临，林天独自一人站在青云宗的后山崖边。山风呼啸，吹动他的衣袍猎猎作响。他仰头望着满天繁星，心中涌起一股前所未有的豪情。

混沌之力在他的经脉中缓缓流淌，虽然还很微弱，但他能感觉到这股力量的潜力远超想象。封印破碎后，他脑海中多出的那段传承记忆告诉他，混沌之力是天地初开时最原始的力量，拥有创造与毁灭的双重属性。

"混沌吞天诀，第一层，混沌初开。"林天闭上眼睛，按照传承中的功法开始运转体内的混沌之力。四周的天地灵气如同受到了召唤，疯狂地向他涌来，在他的身体周围形成了一个肉眼可见的灵气漩涡。

这是他两年来第一次真正意义上的修炼。那种久违的感觉让他浑身颤抖，不是因为痛苦，而是因为激动。他终于可以修炼了，终于可以重新踏上那条逆天改命的道路。

灵气漩涡越转越快，林天的身体开始发出淡淡的金色光芒。他的皮肤表面上浮现出复杂的符文纹路，那是混沌之力在重塑他的经脉，修复那些被震碎的灵脉。

一个时辰后，林天缓缓睁开眼睛。他握了握拳头，感受着体内那股远超从前的力量。

"筑基一层。"他低声说道，嘴角泛起一丝笑意。短短一个时辰，他就重新回到了筑基境，而且现在的基础比两年前更加扎实，更加浑厚。

突然，他的脑海中响起一个苍老的声音。

"不错，能够在这么短的时间内领悟混沌吞天诀的第一层，你的天赋确实惊人。"

林天猛地转身，却没有看到任何人。

"不用找了，我在你的识海里。"那个声音继续说道，"我是混沌吞天诀的上一任主人，混沌天尊。你打破了封印，激活了传承，从今往后，你就是我的传人。"

林天的瞳孔微微收缩。混沌天尊，那可是远古时期传说中的存在，据说他曾经以一人之力镇压了整个魔界，是万古以来最强的大能之一。

"弟子林天，拜见师尊。"林天单膝跪地，恭敬地说道。

"起来吧。"混沌天尊的声音中带着一丝欣慰，"不过，你现在的实力还太弱，传承之力只能发挥出万分之一。要想真正继承我的衣钵，你还需要经历无数的考验和磨砺。"

"弟子明白。"林天坚定地说道，"无论前方有多少艰难险阻，弟子都会一一克服。"

"很好。"混沌天尊说道，"现在，让我告诉你关于那个雨夜的真相，以及为何有人要废掉你的灵脉。"`

describe("小说写作完整流水线 E2E 测试", () => {
  let novelId: string
  let chapter1Id: string
  let chapter2Id: string

  afterAll(() => {
    closeDb(projectDir)
    if (originalOpenNovelDb === undefined) delete process.env.OPENNOVEL_DB
    else process.env.OPENNOVEL_DB = originalOpenNovelDb
    try { rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {}
  })

  test("步骤1：初始化小说项目", async () => {
    const result = initNovelProject(projectDir)
    expect(result).toContain("小说项目初始化完成")
    expect(result).toContain(".novel")
  })

  test("步骤2：创建新书（novels 表写入）", async () => {
    novelId = await createBook(
      "星陨苍穹",
      "玄幻",
      "昔日天才林天灵脉尽碎，沦为废人。两年后，封印在他体内的神秘力量觉醒，混沌之力重铸经脉，他踏上了逆天改命的修炼之路。从青云宗到九天之上，他将揭开一场跨越万古的惊天阴谋。",
    )

    expect(novelId).toBeTruthy()
    expect(typeof novelId).toBe("string")
    expect(novelId.length).toBeGreaterThan(0)
  })

  test("步骤3：生成三级大纲（整体→卷→章）", async () => {
    // 整体大纲
    const masterOutline = await generateMasterOutline(novelId, projectDir)
    expect(masterOutline).toContain("星陨苍穹")
    expect(masterOutline).toContain("整体大纲")
    expect(masterOutline).toContain("故事梗概")
    expect(masterOutline).toContain("主线剧情")
    expect(masterOutline).toContain("角色列表")
    expect(masterOutline).toContain("世界观概要")

    // 卷大纲（第1卷，第1-50章）
    const volumeOutline = await generateVolumeOutline(novelId, 1, projectDir)
    expect(volumeOutline).toContain("星陨苍穹")
    expect(volumeOutline).toContain("第1卷 大纲")
    expect(volumeOutline).toContain("章节范围")
    expect(volumeOutline).toContain("本卷主题")
    expect(volumeOutline).toContain("关键事件")

    // 章节大纲（第1章）
    const ch1Outline = await generateChapterOutline(novelId, 1, projectDir)
    expect(ch1Outline).toContain("第1章 大纲")
    expect(ch1Outline).toContain("章节目标")
    expect(ch1Outline).toContain("关键场景")
    expect(ch1Outline).toContain("角色出场")
    // 文件头卷号不得为 undefined（首章兜底第1卷）
    expect(ch1Outline).toContain("所属卷：第1卷")
    expect(ch1Outline).not.toContain("undefined")

    // 章节大纲（第2章）
    const ch2Outline = await generateChapterOutline(novelId, 2, projectDir)
    expect(ch2Outline).toContain("第2章 大纲")
    expect(ch2Outline).toContain("章节目标")
    expect(ch2Outline).toContain("关键场景")
  })

  test("步骤4：撰写第1章（writer agent + chapter-tools + context 组装）", async () => {
    // 查找第1章的真实 ID
    const { drizzle } = await import("drizzle-orm/bun-sqlite")
    const { eq, and } = await import("drizzle-orm")
    const { sqliteTable, text, integer } = await import("drizzle-orm/sqlite-core")

    // 连接数据库查询章节
    const sqlite = new BunSqlite(dbPath)
    const db = drizzle({ client: sqlite })

    const ChapterTable = sqliteTable("chapters", {
      id: text().primaryKey(),
      novel_id: text().notNull(),
      volume_id: text(),
      title: text().notNull(),
      content: text().notNull().default(""),
      word_count: integer().notNull().default(0),
      status: text().notNull().default("draft"),
      order: integer().notNull(),
      created_at: integer()
        .notNull()
        .$default(() => Date.now()),
      updated_at: integer()
        .notNull()
        .$default(() => Date.now()),
    })

    const [ch1] = await db
      .select()
      .from(ChapterTable)
      .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, 1)))
      .all()
    sqlite.close()

    expect(ch1).toBeTruthy()
    chapter1Id = ch1!.id
    expect(chapter1Id).toBeTruthy()

    // 组装上下文快照
    const snapshot = await assembleSnapshot(novelId, 1)
    expect(snapshot).toBeTruthy()
    expect(snapshot!.novelTitle).toBe("星陨苍穹")
    expect(snapshot!.genre).toBe("玄幻")
    expect(snapshot!.synopsis).toBeTruthy()

    // 使用 chapterWrite 工具写入第1章内容
    const writeResult = await chapterWrite.execute({
      chapterId: chapter1Id,
      content: CHAPTER_1_CONTENT,
    }, { directory: projectDir } as any)

    expect(writeResult).toBeTruthy()
    expect(typeof writeResult).toBe("object")
    const output = typeof writeResult === "string" ? writeResult : (writeResult as any).output
    expect(output).toContain("写入成功")
  })

  test("步骤5：审计第1章（continuity-check 37维）", async () => {
    const result = await checkContinuity(novelId, 1)
    expect(result).toBeTruthy()
    expect(result!.novelId).toBe(novelId)
    expect(result!.chapterNumber).toBe(1)
    expect(result!.dimensions.length).toBe(37)

    // 验证维度名称
    const dimNames = result!.dimensions.map((d) => d.dimension)
    expect(dimNames).toContain("姓名一致性")
    expect(dimNames).toContain("外貌描述")
    expect(dimNames).toContain("因果链")
    expect(dimNames).toContain("伏笔回收")

    // 所有维度都应该有合法的状态
    for (const dim of result!.dimensions) {
      expect(["PASS", "WARN", "FAIL"]).toContain(dim.status)
      expect(dim.detail.length).toBeGreaterThan(0)
    }

    // overall 应该是三种状态之一
    expect(["PASS", "WARN", "FAIL"]).toContain(result!.overall)
  })

  test("步骤6：审批门（approval-gate + 章节状态流转）", async () => {
    // 请求审批
    const approvalRequest = await requestApproval(chapter1Id, CHAPTER_1_CONTENT)
    expect(approvalRequest).toBeTruthy()
    expect(approvalRequest.chapterId).toBe(chapter1Id)
    expect(approvalRequest.novelId).toBe(novelId)
    expect(approvalRequest.title).toBeTruthy()
    expect(approvalRequest.wordCount).toBe(CHAPTER_1_CONTENT.length)
    expect(approvalRequest.status).toBe("pending_review")

    // 审批通过
    const approveResult = await handleApproval(chapter1Id, "APPROVE")
    expect(approveResult.type).toBe("APPROVED")
    expect(approveResult.chapterId).toBe(chapter1Id)

    // 验证章节状态已更新为 final
    const { getChapterStatus } = await import("../../src/novel-writer/chapter-status.js")
    const status = await getChapterStatus(chapter1Id)
    expect(status).toBe("final")
  })

  test("步骤7：撰写第2章（状态写回：ch1 delta → novel_state_log → ch2 snapshot）", async () => {
    // 状态写回：提交第1章的状态变更 delta
    const delta = [
      {
        fact_type: "chapter_summary" as const,
        action: "create" as const,
        entity_id: chapter1Id,
        data: {
          chapter_id: chapter1Id,
          summary: "林天在青云宗备受欺凌，神秘封印在体内蠢蠢欲动。他决心参加三个月后的宗门大比，一场复仇之路即将开启。",
          key_events: ["林天遭受赵峰羞辱", "林天决定参加宗门大比", "封印出现松动"],
          char_changes: ["林天心态从绝望转为坚定"],
        },
      },
      {
        fact_type: "character" as const,
        action: "create" as const,
        entity_id: "char_lintian",
        data: {
          name: "林天",
          role: "主角",
          description: "曾经的天才少年，灵脉被毁后沦为废人，体内封印着神秘的混沌之力",
          chapter_id: chapter1Id,
          active: 1,
          location: "青云宗",
          mood: "坚定",
          summary: "决心参加三个月后的宗门大比，体内封印开始松动",
        },
      },
      {
        fact_type: "foreshadow" as const,
        action: "create" as const,
        entity_id: "foreshadow_seal",
        data: {
          planted_chapter_id: chapter1Id,
          resolved_chapter_id: null,
          content: "林天体内的神秘封印符文，封印破碎后将释放混沌之力",
          state: "planted",
        },
      },
    ]

    const commitCount = await commitState(novelId, chapter1Id, delta)
    expect(commitCount).toBe(3)

    // 查找第2章的章节 ID
    const { drizzle } = await import("drizzle-orm/bun-sqlite")
    const { eq, and } = await import("drizzle-orm")
    const { sqliteTable, text, integer } = await import("drizzle-orm/sqlite-core")

    const sqlite = new BunSqlite(dbPath)
    const db = drizzle({ client: sqlite })

    const ChapterTable = sqliteTable("chapters", {
      id: text().primaryKey(),
      novel_id: text().notNull(),
      volume_id: text(),
      title: text().notNull(),
      content: text().notNull().default(""),
      word_count: integer().notNull().default(0),
      status: text().notNull().default("draft"),
      order: integer().notNull(),
      created_at: integer()
        .notNull()
        .$default(() => Date.now()),
      updated_at: integer()
        .notNull()
        .$default(() => Date.now()),
    })

    const [ch2] = await db
      .select()
      .from(ChapterTable)
      .where(and(eq(ChapterTable.novel_id, novelId), eq(ChapterTable.order, 2)))
      .all()
    sqlite.close()

    expect(ch2).toBeTruthy()
    chapter2Id = ch2!.id

    // 组装第2章的上下文快照，验证 ch1 的状态写回生效
    const snapshot = await assembleSnapshot(novelId, 2)
    expect(snapshot).toBeTruthy()
    expect(snapshot!.novelTitle).toBe("星陨苍穹")

    // ch1 的状态应该出现在 ch2 的快照中
    expect(snapshot!.activeCharacters.length).toBeGreaterThanOrEqual(1)
    const lintian = snapshot!.activeCharacters.find((c) => c.name === "林天")
    expect(lintian).toBeTruthy()
    expect(lintian!.location).toBe("青云宗")

    // 伏笔应该出现在快照中
    const sealForeshadow = snapshot!.foreshadowing.find((f) => f.content.includes("封印"))
    expect(sealForeshadow).toBeTruthy()
    expect(sealForeshadow!.state).toBe("planted")

    // 最近章节摘要应该包含 ch1
    expect(snapshot!.recentChapterSummaries.length).toBeGreaterThanOrEqual(1)
    const ch1Summary = snapshot!.recentChapterSummaries.find((s) => s.chapterOrder === 1)
    expect(ch1Summary).toBeTruthy()
    expect(ch1Summary!.summary).toBeTruthy()

    // 使用 chapterWrite 写入第2章（合成内容）
    const writeResult = await chapterWrite.execute({
      chapterId: chapter2Id,
      content: CHAPTER_2_CONTENT,
    }, { directory: projectDir } as any)

    expect(writeResult).toBeTruthy()
    const output = typeof writeResult === "string" ? writeResult : (writeResult as any).output
    expect(output).toContain("写入成功")

    // runPipeline 已迁移为 pipeline agent（agents/pipeline.ts），
    // 不再可作为直接函数调用。
  })
})
