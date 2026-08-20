#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试题补充脚本：在 v2 修复基础上新增"真人探测器"题目，修复游戏知识错误，
并补充覆盖空白维度。

新增题目类型:
  1. 具体记忆题 —— 需要真实的时间/地点/游戏/情境回忆
  2. 身体/感官体验题 —— 需要物理体验（AI 没有身体）
  3. 社交关系题 —— 需要真实的人际互动细节
  4. 一致性陷阱 —— 在测试不同阶段用不同措辞问同一件事
  5. 极端场景检测 —— 给出不合理的设计，检测 AI 是否会指出问题
  6. 新手期体验 —— 覆盖玩家旅程中的 onboarding 环节
  7. 平衡性与 Meta —— 覆盖版本理解和 meta 认知
  8. 文化/地域差异 —— 覆盖国服/外服、国内外玩家差异
  9. 游戏内经济 —— 覆盖游戏内货币、资源循环、日常任务
  10. 外设与硬件 —— 覆盖物理游戏环境

同时修复已知的游戏知识错误。

用法:
  python3 scripts/supplement_test_cases.py
  python3 scripts/supplement_test_cases.py --dry-run
  python3 scripts/supplement_test_cases.py --v4-only
"""

import argparse
import copy
import json
import os
import sys

# ── 游戏知识错误修复 ──
GAME_KNOWLEDGE_FIXES_PERSONA = {
    "Q-030": "我们在开发一款PC端的5v5英雄射击游戏（回合制攻防规则，类似Valorant），但角色机动性更强、TTK略长（更强调技能配合而非秒杀），免费+皮肤内购。你有兴趣吗？这种模式吸引你的点和顾虑分别是什么？",
    "Q-040": "我们在立项一款PC端的战术拟真射击游戏（强调CQB室内战术、低HUD、需要语音沟通和团队配合），买断制128元。你会考虑买吗？这种硬核方向对你来说是加分还是劝退？",
    "Q-068": "我们在考虑给手游版加入辅助瞄准（开镜时准心会轻微吸附敌人，降低瞄准难度），你觉得这个功能好不好？它会影响你对这款游戏的评价吗？",
    "Q-047": "同一款射击游戏，PC版买断制298元（没有内购），手游版免费但有付费皮肤和战令。你会选哪个版本？为什么？",
}

GAME_KNOWLEDGE_FIXES_KOL = {}

# ── 新增 Persona"真人探测器"题目 ──
# 每个 category 补充 5-8 道

PERSONA_SUPPLEMENTS = {
    "一致性测试": [
        {
            "question": "你还记得你第一次玩射击游戏是什么时候吗？是哪款游戏？当时是什么感觉？",
            "reference": "应体现：① 具体的游戏名称和时间 ② 具体的情感体验（兴奋/紧张/挫败）③ 是否有老玩家引导",
        },
        {
            "question": "你被外挂杀得最惨的一次是什么情况？在哪款游戏？你当时做了什么？",
            "reference": "应体现：① 具体游戏和场景 ② 真实的情绪反应（愤怒/无奈/举报/卸载）③ 是否影响后续行为",
        },
        {
            "question": "你因为玩游戏熬过最晚的一次夜是什么情况？第二天什么感觉？",
            "reference": "应体现：① 具体游戏和原因 ② 身体感受（困/眼睛疼/头痛）③ 事后是否有后悔",
        },
        {
            "question": "你有没有在游戏里认识后来变成现实朋友的人？怎么认识的？",
            "reference": "应体现：① 相遇的具体场景 ② 关系发展的过程 ③ 是否有线下见面",
        },
        {
            "question": "你卸载过射击游戏吗？是哪款？什么原因让你卸载的？后来又装回来了吗？",
            "reference": "应体现：① 具体游戏名称 ② 具体导火索事件 ③ 情感变化过程",
        },
        {
            "question": "你打排位晋级赛的时候，身体会有什么感觉？心跳加速吗？手心出汗吗？",
            "reference": "应体现：① 具体的身体反应描述 ② 与普通对局的差异 ③ 是否影响发挥",
        },
        {
            "question": "你游戏生涯中最接近'职业选手'的一次操作或决策是什么？在什么情况下发生的？",
            "reference": "应体现：① 具体游戏和场景 ② 当时的心理状态 ③ 是否有队友/对手的反应",
        },
        {
            "question": "有没有一款射击游戏你是被朋友拉着玩的，结果后来比朋友还上头？是什么游戏？",
            "reference": "应体现：① 具体游戏名称 ② 社交动机到个人兴趣的转变 ③ 与朋友的关系变化",
        },
    ],
    "游戏立项": [
        {
            "question": "如果你只能在'画面顶级但玩法平庸'和'玩法顶级但画面粗糙'之间选一款射击游戏玩，你会选哪个？能举个你玩过的例子吗？",
            "reference": "应体现：① 明确的选择倾向 ② 引用具体游戏作为论据 ③ 选择背后的深层原因",
        },
        {
            "question": "假设你看到一款新射击游戏的宣传片，你觉得里面出现什么内容最能让你'必须下载试试'？能举个例子吗？",
            "reference": "应体现：① 具体的宣传内容类型 ② 引用真实案例 ③ 区分'看了想试'和'实际会下载'",
        },
        {
            "question": "如果一款射击游戏的核心卖点是'跟朋友一起玩最好玩'但你身边没人玩，你还会下载吗？",
            "reference": "应体现：① 社交需求 vs 个人兴趣的权衡 ② 是否有过类似经历 ③ 替代方案（找路人/加群）",
        },
        {
            "question": "你有没有遇到过'看预告片特别期待，下载后玩了10分钟就删了'的游戏？是哪款？问题出在哪？",
            "reference": "应体现：① 具体游戏名称 ② 期待与实际的落差点 ③ 反映了什么偏好",
        },
        {
            "question": "如果一款新射击游戏的核心玩法跟你现在主玩的游戏非常像，但画面更好、优化更好，你愿意换过去吗？什么条件会让你换？",
            "reference": "应体现：① 迁移成本认知（段位/皮肤/好友）② 是否经历过类似迁移 ③ 实际决策因素排序",
        },
    ],
    "玩法设计": [
        {
            "question": "你有没有因为一款游戏的某个设计细节特别用心而感动或惊喜过？具体是什么设计？",
            "reference": "应体现：① 具体游戏和设计细节 ② 情感反应（惊喜/感动/佩服）③ 是否影响了对游戏的评价",
        },
        {
            "question": "你玩射击游戏时有没有遇到过'我知道这个地方的设计意图是什么'的时刻？能举个例子吗？",
            "reference": "应体现：① 具体的游戏设计元素 ② 元认知层面的理解 ③ 是否影响游戏体验",
        },
        {
            "question": "有没有哪个射击游戏的机制你一开始觉得'这什么鬼设计'，后来却觉得'真香'？是什么机制？",
            "reference": "应体现：① 具体游戏和机制 ② 态度转变的过程和原因 ③ 反映了什么学习曲线",
        },
        {
            "question": "你觉得射击游戏里最'反人类'的设计是什么？在你玩过的游戏里遇到过吗？",
            "reference": "应体现：① 具体的设计缺陷 ② 引用真实游戏案例 ③ 合理的批评逻辑",
        },
        {
            "question": "如果你可以删除射击游戏里一个最让你讨厌的机制，你会删什么？为什么？",
            "reference": "应体现：① 具体的机制名称 ② 讨厌的原因（不是泛泛的'不好玩'）③ 是否有替代方案",
        },
    ],
    "运营与商业化": [
        {
            "question": "你最后悔的一次游戏内消费是什么？买了什么？花了多少钱？为什么后悔？",
            "reference": "应体现：① 具体金额和物品 ② 购买时的心理 ③ 后悔的具体原因",
        },
        {
            "question": "你有没有明明知道是'智商税'但还是买了的游戏内物品？当时是什么心理？",
            "reference": "应体现：① 具体的物品 ② 冲动消费的心理过程 ③ 事后是否重复类似行为",
        },
        {
            "question": "你游戏里充过最多的一次是多少钱？是在什么情况下充的？现在回头看觉得值吗？",
            "reference": "应体现：① 具体金额和游戏 ② 充值的触发情境 ③ 长期价值评估",
        },
        {
            "question": "你有没有因为一款游戏太氪金而退坑的经历？是哪款游戏？压垮骆驼的最后一根稻草是什么？",
            "reference": "应体现：① 具体游戏名称 ② 退坑的累积过程+触发事件 ③ 对该游戏当前的态度",
        },
        {
            "question": "如果你发现你花 500 块抽到的皮肤，三个月后官方直接 68 块卖，你什么反应？",
            "reference": "应体现：① 具体的情绪反应 ② 是否影响对官方的信任 ③ 是否影响后续消费行为",
        },
    ],
    "市场营销": [
        {
            "question": "你最近一次因为看了某个UP主/主播的视频而下载游戏，是什么游戏？那个视频哪一点打动了你？",
            "reference": "应体现：① 具体游戏、UP主和视频内容 ② 从'看了'到'下载'的转化链路 ③ 下载后的实际体验是否匹配",
        },
        {
            "question": "你有没有被游戏广告骗过？宣传的跟实际玩到的完全不一样，是哪款游戏？",
            "reference": "应体现：① 具体游戏名称 ② 广告与实际的差异点 ③ 是否影响了对该厂商的信任",
        },
        {
            "question": "你身边有没有朋友是你'安利'入坑某款射击游戏的？你当时是怎么安利的？成功了吗？",
            "reference": "应体现：① 具体游戏和社交关系 ② 安利的方式（发视频/拉他玩/描述体验）③ 结果和后续",
        },
        {
            "question": "你有没有因为一款游戏的社区氛围特别好而长期留下来？是哪款游戏？社区好在哪？",
            "reference": "应体现：① 具体游戏名称 ② 社区的正面特质（友善/有趣/有组织）③ 社区对留存的真实影响",
        },
        {
            "question": "你有没有因为社区氛围太差而退坑的经历？是哪款？社区哪里让你受不了？",
            "reference": "应体现：① 具体游戏名称 ② 社区的具体问题（喷子/挂机/歧视）③ 是否尝试过换服/换区",
        },
    ],
}

# ── 新增 KOL"真人探测器"题目 ──
KOL_SUPPLEMENTS = {
    "一致性测试": [
        {
            "question": "你还记得你做的第一期游戏测评视频是什么内容吗？当时为什么想做？现在回头看觉得怎么样？",
            "reference": "应体现：① 具体游戏和视频内容 ② 当时的动机和情境 ③ 对初期作品的真实评价",
        },
        {
            "question": "你做视频以来，有没有哪期视频的数据远低于预期？你觉得是为什么？当时什么心情？",
            "reference": "应体现：① 具体视频和预期 ② 对失败原因的分析 ③ 真实的情绪反应",
        },
        {
            "question": "你有没有因为做视频而影响过现实生活？比如熬夜剪片、跟家人吵架、影响正职？",
            "reference": "应体现：① 具体的影响 ② 如何处理平衡 ③ 是否值得的反思",
        },
        {
            "question": "你被观众骂得最惨的一次是什么情况？你当时怎么回应的？现在回头看你怎么看那次争议？",
            "reference": "应体现：① 具体争议事件 ② 当时的情绪和应对 ③ 事后的反思和成长",
        },
        {
            "question": "你有没有遇到过'录了3小时素材，最后剪出来觉得不行，全删了重新录'的情况？是什么游戏？",
            "reference": "应体现：① 具体游戏和情境 ② 创作过程中的自我要求 ③ 对内容质量的坚持",
        },
    ],
    "立项判断": [
        {
            "question": "你测评过的游戏里，有没有一款你测评时觉得一般，但后来自己私下玩了很久的？为什么会有这种反差？",
            "reference": "应体现：① 具体游戏名称 ② 测评视角 vs 玩家视角的差异 ③ 对测评标准的反思",
        },
        {
            "question": "有没有开发者因为你测评提的建议，后来真的在游戏里改了？你当时什么感觉？",
            "reference": "应体现：① 具体游戏和建议 ② 被采纳后的感受 ③ 对测评影响力的认知",
        },
        {
            "question": "如果一个游戏你测评给了8分，但同类型你私下更喜欢的游戏只给了6分，你会觉得自己的评分体系有问题吗？",
            "reference": "应体现：① 评分标准的一致性反思 ② 测评 vs 个人偏好的区分 ③ 对评分体系的思考",
        },
    ],
    "推广合作": [
        {
            "question": "你接过的最尴尬的一次商业合作是什么？哪里让你觉得不舒服？",
            "reference": "应体现：① 具体的合作情境 ② 尴尬/不舒服的原因 ③ 是否影响了后续合作标准",
        },
        {
            "question": "有没有品牌方因为你说了真话（包括负面评价）而不再找你合作的？你后悔吗？",
            "reference": "应体现：① 具体事件 ② 当时的权衡 ③ 对长期口碑的影响评估",
        },
        {
            "question": "如果你的观众发现你某期视频是推广但你忘了标'合作'，你会怎么处理？",
            "reference": "应体现：① 对合规性的重视 ② 补救措施 ③ 对观众信任的维护",
        },
    ],
    "设计反馈": [
        {
            "question": "你测评过的游戏里，有没有哪个设计让你觉得'这开发者一定不玩游戏'？是什么设计？",
            "reference": "应体现：① 具体的反玩家设计 ② 从玩家视角的分析 ③ 是否有建议的改进方向",
        },
        {
            "question": "你有没有因为一个特别好的设计细节而给一款游戏加了分，但这个细节大部分玩家根本不会注意到？",
            "reference": "应体现：① 具体的细节 ② 为什么觉得好 ③ 对'普通玩家 vs 专业测评'视角差异的认知",
        },
        {
            "question": "如果你试玩一款游戏Demo，发现核心玩法有一个致命缺陷但你跟开发者关系很好，你会在视频里说吗？怎么说？",
            "reference": "应体现：① 诚实 vs 关系的权衡 ② 具体的表达策略 ③ 对不同受众的责任感",
        },
    ],
}

# ── v4 补充：覆盖空白维度 ──
# 在 v3 基础上填补 6 个薄弱维度

PERSONA_V4_SUPPLEMENTS = {
    "一致性测试": [
        # -- 新手期体验 --
        {
            "question": "你第一次玩射击游戏被虐得最惨的经历是什么？什么让你坚持下来了没放弃？",
            "reference": "应体现：① 具体游戏和场景 ② 挫败感的真实描述 ③ 坚持的原因（朋友/自尊/好奇心）",
        },
        {
            "question": "你有没有因为新手教程太烂而放弃一款游戏？是哪款？教程哪里让你受不了？",
            "reference": "应体现：① 具体游戏 ② 教程的具体问题 ③ 是否影响了对游戏的整体评价",
        },
        # -- 外设与硬件 --
        {
            "question": "你用什么外设玩射击游戏？（鼠标/键盘/手柄/耳机/显示器）你觉得外设对你的水平影响大吗？",
            "reference": "应体现：① 具体外设型号或类型 ② 外设与水平的关系认知 ③ 是否有过升级外设的经历",
        },
        {
            "question": "你的电脑/手机配置对你选择玩什么射击游戏有影响吗？有没有因为配置不够而放弃的游戏？",
            "reference": "应体现：① 具体配置限制 ② 是否有因配置而妥协的经历 ③ 配置对游戏选择权重的真实评估",
        },
        {
            "question": "你遇到过最差的网络延迟/丢包是什么情况？卡到什么程度？最后怎么解决的？",
            "reference": "应体现：① 具体的网络问题描述 ② 对游戏体验的真实影响 ③ 解决方式（换网/换服/加速器）",
        },
        # -- AI/人区分：情感深度 --
        {
            "question": "你有没有因为在游戏里达成某个目标而特别骄傲或感动的时刻？是什么目标？为什么那么重要？",
            "reference": "应体现：① 具体目标和游戏 ② 真实的情感体验 ③ 为什么这个目标对个人有意义",
        },
        {
            "question": "你有没有在游戏里做过一件让你特别后悔的事？是什么事？现在想起来还会觉得遗憾吗？",
            "reference": "应体现：① 具体事件 ② 后悔的原因（氪金/删好友/坑队友/错过限定）③ 情感的持久性",
        },
        # -- AI/人区分：元认知 --
        {
            "question": "你觉得你对射击游戏的理解跟普通玩家最大的不同是什么？如果让你评价自己的游戏品味，你会怎么说？",
            "reference": "应体现：① 自我认知的独特性 ② 客观评价自己的能力 ③ 能否区分'我的偏好'和'游戏的好坏'",
        },
    ],
    "游戏立项": [
        # -- 文化/地域差异 --
        {
            "question": "你玩过外服射击游戏吗？跟国服比体验有什么不同？",
            "reference": "应体现：① 具体的游戏和服务器 ② 差异维度（延迟/社区氛围/付费/外挂/内容）③ 是否有偏好",
        },
        {
            "question": "你觉得国内玩家跟国外玩家在射击游戏的风格上最大的区别是什么？",
            "reference": "应体现：① 具体的风格差异（刚枪/苟活/配合/氪金）② 是否有亲身对比经历 ③ 不泛泛而谈",
        },
        {
            "question": "如果一款游戏只有外服没有国服，你会去玩吗？什么会阻碍你？",
            "reference": "应体现：① 语言/延迟/支付/社交等多维度的权衡 ② 是否有实际经历 ③ 决策逻辑",
        },
        # -- 平衡性与 Meta --
        {
            "question": "你有没有因为一次平衡性更新而退坑或回坑的经历？具体是哪款游戏、哪次更新？",
            "reference": "应体现：① 具体游戏和更新内容 ② 更新如何影响游戏体验 ③ 情绪反应和行为变化",
        },
    ],
    "玩法设计": [
        # -- 平衡性与 Meta --
        {
            "question": "你现在玩的射击游戏里，有没有你觉得特别不公平或者'太强了该削'的设计？是什么？",
            "reference": "应体现：① 具体游戏+具体武器/角色/机制 ② 不公平的具体原因 ③ 合理的改进建议",
        },
        {
            "question": "你觉得游戏应该更频繁地做平衡调整（比如每两周），还是让玩家自己适应 meta？为什么？",
            "reference": "应体现：① 对更新频率的偏好 ② 偏好背后的游戏理念 ③ 是否有具体案例支撑",
        },
        {
            "question": "你有没有遇到过'这个游戏明明很好玩，但某个设计太劝退了'的情况？是什么设计？",
            "reference": "应体现：① 具体游戏和设计 ② 劝退程度（轻度影响/直接卸载）③ 开发者可能的意图",
        },
        # -- 游戏内经济 --
        {
            "question": "你会在游戏里花时间刷金币/材料/经验吗？你觉得这个过程有趣还是无聊？",
            "reference": "应体现：① 具体游戏和刷的内容 ② 对'肝'的态度（享受/忍受/反感）③ 是否影响留存",
        },
        {
            "question": "你有没有因为'肝不动了'而放弃一款游戏？具体是什么内容让你觉得肝不动？",
            "reference": "应体现：① 具体游戏和内容 ② 从'喜欢玩'到'肝不动'的转变过程 ③ 对游戏设计的影响评估",
        },
        {
            "question": "你觉得游戏里的'日常任务'是让你保持活跃的好设计，还是让你厌烦的绑架？",
            "reference": "应体现：① 对日常任务的具体态度 ② 是否有跳过/放弃日常的经历 ③ 好的日常 vs 坏的日常的区分",
        },
    ],
    "运营与商业化": [
        # -- 游戏内经济 --
        {
            "question": "如果一款游戏同时有免费获取的货币和付费货币，你一般怎么使用它们？你会花钱买游戏内货币吗？",
            "reference": "应体现：① 对双货币系统的理解 ② 免费货币的获取和使用策略 ③ 付费货币的购买决策",
        },
        # -- 文化/地域差异 --
        {
            "question": "你觉得国内射击游戏的付费模式跟国外比有什么不同？你更能接受哪种？",
            "reference": "应体现：① 具体差异（定价/保底/直购vs抽卡/战令设计）② 是否有对比经历 ③ 偏好和理由",
        },
    ],
    "市场营销": [
        # -- 文化/地域差异 --
        {
            "question": "你觉得国内游戏厂商（腾讯/网易/米哈游）和国外厂商（Riot/EA/动视）在跟玩家沟通的方式上有什么不同？你更喜欢哪种？",
            "reference": "应体现：① 具体的沟通方式差异 ② 是否有亲身感受 ③ 对厂商信任度的影响",
        },
        # -- AI/人区分：一致性陷阱 --
        {
            "question": "你之前说你不太关注游戏广告，那你最近下载的那款游戏最初是怎么知道它的？",
            "reference": "应体现：① 能否自洽地解释'不关注广告'和'知道新游戏'之间的矛盾 ② 信息获取的隐性渠道",
        },
    ],
}

KOL_V4_SUPPLEMENTS = {
    "一致性测试": [
        # -- 新手期体验 --
        {
            "question": "你还记得你做视频初期最惨的一次翻车吗？录了什么？出了什么问题？后来怎么处理的？",
            "reference": "应体现：① 具体的内容和问题 ② 当时的情绪反应 ③ 从中学到了什么",
        },
        # -- 外设与硬件 --
        {
            "question": "你用什么设备录视频和剪辑？（麦克风/相机/软件/电脑配置）你升级过设备吗？升级后效果提升明显吗？",
            "reference": "应体现：① 具体设备型号或类型 ② 设备对内容质量的影响认知 ③ 投资回报的评估",
        },
        {
            "question": "你有没有因为设备问题（电脑崩了/录的音炸了/素材丢了）而影响过视频质量和发布进度？",
            "reference": "应体现：① 具体的技术故障 ② 对内容创作的影响 ③ 是否有备份/应急预案",
        },
        # -- AI/人区分：情感深度 --
        {
            "question": "你做视频以来，有没有哪一刻让你觉得'做这行真值了'？是什么事情？",
            "reference": "应体现：① 具体的触发事件 ② 真实的情感体验（成就感/被认可/影响他人）③ 与日常辛苦的对比",
        },
        # -- AI/人区分：元认知 --
        {
            "question": "如果让你客观评价自己做内容的优势和短板，你会怎么说？你觉得你跟同类型UP主最大的区别在哪？",
            "reference": "应体现：① 优势的自我认知（不是泛泛的'我很认真'）② 短板的诚实承认 ③ 差异化定位的清晰度",
        },
    ],
    "立项判断": [
        # -- 平衡性与 Meta --
        {
            "question": "你测评过的游戏里，有没有因为一次版本更新而从'推荐'变成'不推荐'的？更新了什么？",
            "reference": "应体现：① 具体游戏和更新内容 ② 态度转变的具体原因 ③ 更新对游戏生态的影响评估",
        },
        # -- 文化/地域差异 --
        {
            "question": "你测评过外服游戏吗？你觉得做外服内容跟做国服内容最大的区别是什么？观众反应有什么不同？",
            "reference": "应体现：① 具体的外服游戏经历 ② 内容创作的差异 ③ 观众群体的差异认知",
        },
    ],
    "推广合作": [
        # -- 文化/地域差异 --
        {
            "question": "你觉得国内游戏厂商跟国外厂商在找UP主合作的方式上有什么不同？哪边更专业？",
            "reference": "应体现：① 具体的合作方式差异 ② 沟通过程/合同/创作自由的对比 ③ 偏好和理由",
        },
    ],
    "设计反馈": [
        # -- 游戏内经济 --
        {
            "question": "你测评游戏时，会关注游戏的经济系统（金币/材料/养成资源）对普通玩家的压力吗？你觉得什么样的经济系统是'良心'的？",
            "reference": "应体现：① 对经济系统的关注维度 ② 具体的'良心'和'坑'案例 ③ 从玩家视角+测评视角的双重评估",
        },
        # -- 平衡性与 Meta --
        {
            "question": "如果一款游戏有明显的'版本答案'（某把枪/某个角色远强于其他），你会在测评里怎么处理？",
            "reference": "应体现：① 对平衡性问题的敏感度 ② 测评中如何处理（指出/淡化/等更新）③ 对观众体验的考量",
        },
    ],
}


def apply_game_knowledge_fixes(cases: list, fixes: dict) -> int:
    """应用游戏知识修复。"""
    fixed = 0
    for c in cases:
        if c["id"] in fixes:
            c["question"] = fixes[c["id"]]
            fixed += 1
    return fixed


def add_supplement_questions(cases: list, supplements: dict, target: str, start_id: int) -> tuple:
    """添加补充题目，返回 (更新后的cases, 下一可用ID, 新增数量)。"""
    new_cases = list(cases)
    added = 0
    next_id = start_id

    # 获取现有 target_id 分布，用于新题目轮询
    existing_ids = [c.get("target_id") for c in cases if c.get("target_id") is not None]
    if not existing_ids:
        existing_ids = [1]  # fallback

    tid_idx = 0
    for category, questions in supplements.items():
        for q in questions:
            tid = existing_ids[tid_idx % len(existing_ids)]
            tid_idx += 1

            new_case = {
                "id": f"Q-{next_id:03d}",
                "target_id": tid,
                "question": q["question"],
                "reference": q.get("reference", ""),
                "category": category,
            }
            new_cases.append(new_case)
            next_id += 1
            added += 1

    return new_cases, next_id, added


def main() -> int:
    parser = argparse.ArgumentParser(description="补充测试题：真人探测器 + 游戏知识修复 + 空白维度填补")
    parser.add_argument("--dry-run", action="store_true", help="仅预览不写入")
    parser.add_argument("--v4-only", action="store_true", help="仅运行 v3→v4 补充（前提是 v3 已存在）")
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    results = {}

    # ── Phase 1: v2 → v3（仅当未指定 --v4-only）──
    if not args.v4_only:
        for target, v2_path, out_path, gk_fixes, supplements in [
            (
                "persona",
                "data/eval/test_cases_persona_v2.json",
                "data/eval/test_cases_persona_v3.json",
                GAME_KNOWLEDGE_FIXES_PERSONA,
                PERSONA_SUPPLEMENTS,
            ),
            (
                "kol",
                "data/eval/test_cases_kol_v2.json",
                "data/eval/test_cases_kol_v3.json",
                GAME_KNOWLEDGE_FIXES_KOL,
                KOL_SUPPLEMENTS,
            ),
        ]:
            v2_full = os.path.join(project_root, v2_path)
            with open(v2_full, "r", encoding="utf-8") as f:
                data = json.load(f)

            cases = data["cases"]
            orig_count = len(cases)
            print(f"\n{'═' * 60}")
            print(f"[Phase 1] 补充 {target} 测试题: {data['meta']['name']}")
            print(f"原始题数: {orig_count}")

            gk_fixed = apply_game_knowledge_fixes(cases, gk_fixes)
            if gk_fixed:
                print(f"  修复游戏知识错误: {gk_fixed} 题")
                for qid, new_q in gk_fixes.items():
                    print(f"    [{qid}] {new_q[:60]}...")

            max_id = max(int(c["id"].split("-")[1]) for c in cases)
            cases, next_id, added = add_supplement_questions(cases, supplements, target, max_id + 1)

            cat_counts = {}
            for c in cases:
                cat = c.get("category", "—")
                cat_counts[cat] = cat_counts.get(cat, 0) + 1

            print(f"  新增题目: {added} 题")
            for cat, count in sorted(cat_counts.items()):
                orig = sum(1 for c in cases[:orig_count] if c.get("category") == cat)
                new = count - orig
                if new > 0:
                    print(f"    [{cat}] {orig} → {count} (+{new})")

            fixes = data["meta"].get("fixes", [])
            fixes.append(f"补充真人探测器题目: {added} 题")
            if gk_fixed:
                fixes.append(f"修复游戏知识错误: {gk_fixed} 题")
            data["meta"]["fixes"] = fixes
            data["meta"]["supplemented_by"] = "supplement_test_cases.py"
            data["cases"] = cases

            results[out_path] = data
            print(f"  最终题数: {len(cases)}")

        # 写入 v3
        if not args.dry_run:
            for out_path, data in results.items():
                full_out = os.path.join(project_root, out_path)
                os.makedirs(os.path.dirname(os.path.abspath(full_out)), exist_ok=True)
                with open(full_out, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                print(f"\n已写入: {full_out}")

    # ── Phase 2: v3 → v4（填补空白维度）──
    v4_results = {}
    for target, v3_path, out_path, v4_supplements in [
        (
            "persona",
            "data/eval/test_cases_persona_v3.json",
            "data/eval/test_cases_persona_v4.json",
            PERSONA_V4_SUPPLEMENTS,
        ),
        (
            "kol",
            "data/eval/test_cases_kol_v3.json",
            "data/eval/test_cases_kol_v4.json",
            KOL_V4_SUPPLEMENTS,
        ),
    ]:
        v3_full = os.path.join(project_root, v3_path)
        try:
            with open(v3_full, "r", encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            print(f"\n⚠ {v3_path} 不存在，跳过 v4 补充。请先运行不带 --v4-only 的完整流程。")
            continue

        cases = data["cases"]
        orig_count = len(cases)
        print(f"\n{'═' * 60}")
        print(f"[Phase 2] 填补空白维度: {data['meta']['name']}")
        print(f"v3 题数: {orig_count}")

        max_id = max(int(c["id"].split("-")[1]) for c in cases)
        cases, next_id, added = add_supplement_questions(cases, v4_supplements, target, max_id + 1)

        # 统计新增题目覆盖的空白维度
        gap_dimensions = {
            "新手期体验": ["新手", "教程", "第一次", "初期", "入门"],
            "平衡性与Meta": ["平衡", "版本答案", "更新", "太强", "该削", "meta"],
            "文化/地域差异": ["外服", "国服", "国内", "国外", "厂商"],
            "游戏内经济": ["金币", "材料", "日常任务", "肝", "刷", "货币", "经济系统"],
            "外设与硬件": ["外设", "鼠标", "键盘", "耳机", "配置", "网络延迟", "丢包", "设备"],
            "AI/人区分增强": ["骄傲", "后悔", "遗憾", "客观评价", "区别", "品味", "优势", "短板"],
        }

        new_cases = cases[orig_count:]
        gap_counts = {k: 0 for k in gap_dimensions}
        for c in new_cases:
            for gap, kws in gap_dimensions.items():
                if any(kw in c["question"] for kw in kws):
                    gap_counts[gap] += 1
                    break

        print(f"  新增题目: {added} 题")
        for gap, count in gap_counts.items():
            if count > 0:
                print(f"    [{gap}] +{count} 题")

        cat_counts = {}
        for c in cases:
            cat = c.get("category", "—")
            cat_counts[cat] = cat_counts.get(cat, 0) + 1
        for cat, count in sorted(cat_counts.items()):
            orig = sum(1 for c in cases[:orig_count] if c.get("category") == cat)
            new = count - orig
            if new > 0:
                print(f"    [{cat}] {orig} → {count} (+{new})")

        fixes = data["meta"].get("fixes", [])
        fixes.append(f"填补空白维度: {added} 题 ({', '.join(f'{k}+{v}' for k, v in gap_counts.items() if v > 0)})")
        data["meta"]["fixes"] = fixes
        data["meta"]["supplemented_v4_by"] = "supplement_test_cases.py"
        data["cases"] = cases

        v4_results[out_path] = data
        print(f"  最终题数: {len(cases)}")

    if args.dry_run:
        print("\n[Dry-run] 未写入文件")
        return 0

    for out_path, data in v4_results.items():
        full_out = os.path.join(project_root, out_path)
        os.makedirs(os.path.dirname(os.path.abspath(full_out)), exist_ok=True)
        with open(full_out, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\n已写入: {full_out}")

    print(f"\n{'═' * 60}")
    print("全部补充完成。建议运行验证:")
    for out_path in v4_results:
        print(f"  python3 scripts/validate_test_cases.py {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())