/* ============================================================
 * 晓林影视 XIAOLIN-TV · 腾讯TV极光风格 (云视听极光) 终端大屏交互引擎
 * 核心特性:
 *  1. 严格设备隔离: 电脑/手机打开默认网址 100% 保持原设备 UI，仅真机 TV / APK 或明确带 ?tv=1 参数时激活 TV 端
 *  2. 极简顶栏: 搜索 | 精选 | 电影 | 剧集 | 综艺 | 动漫 | 直播 (焦点停留 180ms 自动切换频道) + 右侧「👤 我的 | 13:20」一体胶囊 (永久移除顶部公告栏与底部提示栏)
 *  3. 严格 4 列矩阵方向键导航 + 100% 统一高度海报卡: 彻底解决机顶盒方向键下/右错乱与卡片高矮不一
 *  4. 左侧固定紧凑全键盘(仅 A-Z + 退格/清空，移除九宫格与数字) + 底部固定手机扫码同步搜 + 右侧 4 列独立滚动
 *  5. TV 专属播放页工作台: 左屏 16:9 播放窗 + 右侧换源/5列选集/无乱码简介 + 下方 4 列相关推荐 + 一键全屏切换
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 1. TV 模式识别 (严格隔离电脑端与 TV 端，绝不污染 localStorage) ---------------- */
  function checkTvMode() {
    try {
      try {
        localStorage.removeItem('ntv:tvMode');
        sessionStorage.removeItem('ntv_tv_override');
      } catch (e) {}

      var pathStr = (location.pathname || '/').replace(/^\/+|\/+$/g, '');
      var hashStr = location.hash || '';
      var searchStr = (location.search || '') + '&' + (hashStr.split('?')[1] || '');

      // 管理员后台与手机扫码遥控器页面永远使用电脑/手机原生界面
      if (pathStr === 'xiaolin1991' || pathStr === 'admin' || /^#\/(xiaolin1991|admin|tv-remote)/i.test(hashStr) || /(?:^|[?&])tv_sid=/i.test(searchStr)) {
        return false;
      }
      if (/(?:^|[?&])tv=0(?:&|$)/i.test(searchStr)) {
        return false;
      }
      // 电脑端仅当 URL 明确带有 ?tv=1 参数时才进入 TV 调试预览
      if (/(?:^|[?&])tv=1(?:&|$)/i.test(searchStr)) {
        return true;
      }
      if (window.AndroidBridge && typeof window.AndroidBridge.isTv === 'function') {
        try { if (window.AndroidBridge.isTv()) return true; } catch (e) {}
      }
      var ua = navigator.userAgent || '';
      if (/XIAOLIN-TV-OS|LargeScreen|SmartTV|GoogleTV|Android\s*TV|Leanback|AFTB|AFTM|AFTT|AFTS|AFTN|MiBOX|MiTV|Tizen|Web0S|BRAVIA|Changhong|Hisense|Konka|Skyworth|TCL|VIDAA|Himedia|Dangbei|Projector/i.test(ua)) {
        return true;
      }
      var noTouch = !('ontouchstart' in window) && (navigator.maxTouchPoints || 0) === 0;
      return /Android/i.test(ua) && noTouch;
    } catch (e) {
      return false;
    }
  }

  if (!checkTvMode()) {
    document.body.classList.remove('tv', 'tv-playing', 'tv-fs-mode');
    document.documentElement.classList.remove('tv-root');
    return;
  }

  document.body.classList.add('tv');
  document.documentElement.classList.add('tv-root');

  /* ---------------- 2. 3767 常用汉字 100% 确定性拼音首字母表 (不依赖机顶盒 ICU) ---------------- */
  var PY_TABLE = {"A": "啊阿埃挨哎唉哀皑癌蔼矮艾碍爱隘鞍氨安俺按暗岸胺案肮昂盎凹敖熬翱袄傲奥懊澳", "B": "芭捌扒叭吧笆八疤巴拔跋靶把耙坝霸罢爸白柏百摆佰败拜稗斑班搬扳般颁板版扮拌伴瓣半办绊邦帮梆榜膀绑棒磅蚌镑傍谤苞胞包褒剥薄雹保堡饱宝抱报暴豹鲍爆杯碑悲卑北辈背贝钡倍狈备惫焙被奔苯本笨崩绷甭泵蹦迸逼鼻比鄙笔彼碧蓖蔽毕毙毖币庇痹闭敝弊必辟壁臂避陛鞭边编贬扁便变卞辨辩辫遍标彪膘表鳖憋别瘪彬斌濒滨宾摈兵冰柄丙秉饼炳病并玻菠播拨钵波博勃搏铂箔伯帛舶脖膊渤泊驳捕卜哺补埠不布步簿部怖飙镖蝙婊", "C": "擦猜裁材才财睬踩采彩菜蔡餐参蚕残惭惨灿苍舱仓沧藏操糙槽曹草厕策侧册测层蹭插叉茬茶查碴搽察岔差诧拆柴豺搀掺蝉馋谗缠铲产阐颤昌猖场尝常长偿肠厂敞畅唱倡超抄钞朝嘲潮巢吵炒车扯撤掣彻澈郴臣辰尘晨忱沉陈趁衬撑称城橙成呈乘程惩澄诚承逞骋秤吃痴持匙池迟弛驰耻齿侈尺赤翅斥炽充冲虫崇宠抽酬畴踌稠愁筹仇绸瞅丑臭初出橱厨躇锄雏滁除楚础储矗搐触处揣川穿椽传船喘串疮窗幢床闯创吹炊捶锤垂春椿醇唇淳纯蠢戳绰疵茨磁雌辞慈瓷词此刺赐次聪葱囱匆从丛凑粗醋簇促蹿篡窜摧崔催脆瘁粹淬翠村存寸磋撮搓措挫错穹", "D": "搭达答瘩打大呆歹傣戴带殆代贷袋待逮怠耽担丹单郸掸胆旦氮但惮淡诞弹蛋当挡党荡档刀捣蹈倒岛祷导到稻悼道盗德得的蹬灯登等瞪凳邓堤低滴迪敌笛狄涤翟嫡抵底地蒂第帝弟递缔颠掂滇碘点典靛垫电佃甸店惦奠淀殿碉叼雕凋刁掉吊钓调跌爹碟蝶迭谍叠丁盯叮钉顶鼎锭定订丢东冬董懂动栋侗恫冻洞兜抖斗陡豆逗痘都督毒犊独读堵睹赌杜镀肚度渡妒端短锻段断缎堆兑队对墩吨蹲敦顿囤钝盾遁掇哆多夺垛躲朵跺舵剁惰堕", "E": "蛾峨鹅俄额讹娥恶厄扼遏鄂饿恩而儿耳尔饵洱二贰", "F": "发罚筏伐乏阀法珐藩帆番翻樊矾钒繁凡烦反返范贩犯饭泛坊芳方肪房防妨仿访纺放菲非啡飞肥匪诽吠肺废沸费芬酚吩氛分纷坟焚汾粉奋份忿愤粪丰封枫蜂峰锋风疯烽逢冯缝讽奉凤佛否夫敷肤孵扶拂辐幅氟符伏俘服浮涪福袱弗甫抚辅俯釜斧脯腑府腐赴副覆赋复傅付阜父腹负富讣附妇缚咐", "G": "噶嘎该改概钙盖溉干甘杆柑竿肝赶感秆敢赣冈刚钢缸肛纲岗港杠篙皋高膏羔糕搞镐稿告哥歌搁戈鸽胳疙割革葛格蛤阁隔铬个各给根跟耕更庚羹埂耿梗工攻功恭龚供躬公宫弓巩汞拱贡共钩勾沟苟狗垢构购够辜菇咕箍估沽孤姑鼓古蛊骨谷股故顾固雇刮瓜剐寡挂褂乖拐怪棺关官冠观管馆罐惯灌贯光广逛瑰规圭硅归龟闺轨鬼诡癸桂柜跪贵刽辊滚棍锅郭国果裹过", "H": "哈骸孩海氦亥害骇酣憨邯韩含涵寒函喊罕翰撼捍旱憾悍焊汗汉夯杭航壕嚎豪毫郝好耗号浩呵喝荷菏核禾和何合盒貉阂河涸赫褐鹤贺嘿黑痕很狠恨哼亨横衡恒轰哄烘虹鸿洪宏弘红喉侯猴吼厚候后呼乎忽瑚壶葫胡蝴狐糊湖弧虎唬护互沪户花哗华猾滑画划化话槐徊怀淮坏欢环桓还缓换患唤痪豢焕涣宦幻荒慌黄磺蝗簧皇凰惶煌晃幌恍谎灰挥辉徽恢蛔回毁悔慧卉惠晦贿秽会烩汇讳诲绘荤昏婚魂浑混豁活伙火获或惑霍货祸嬛", "J": "击圾基机畸稽积箕肌饥迹激讥鸡姬绩缉吉极棘辑籍集及急疾汲即嫉级挤几脊己蓟技冀季伎祭剂悸济寄寂计记既忌际妓继纪嘉枷夹佳家加荚颊贾甲钾假稼价架驾嫁歼监坚尖笺间煎兼肩艰奸缄茧检柬碱硷拣捡简俭剪减荐槛鉴践贱见键箭件健舰剑饯渐溅涧建僵姜将浆江疆蒋桨奖讲匠酱降蕉椒礁焦胶交郊浇骄娇嚼搅铰矫侥脚狡角饺缴绞剿教酵轿较叫窖揭接皆秸街阶截劫节桔杰捷睫竭洁结解姐戒藉芥界借介疥诫届巾筋斤金今津襟紧锦仅谨进靳晋禁近烬浸尽劲荆兢茎睛晶鲸京惊精粳经井警景颈静境敬镜径痉靖竟竞净炯窘揪究纠玖韭久灸九酒厩救旧臼舅咎就疚鞠拘狙疽居驹菊局咀矩举沮聚拒据巨具距踞锯俱句惧炬剧捐鹃娟倦眷卷绢撅攫抉掘倔爵觉决诀绝均菌钧军君峻俊竣浚郡骏囧", "K": "喀咖卡咯开揩楷凯慨刊堪勘坎砍看康慷糠扛抗亢炕考拷烤靠坷苛柯棵磕颗科壳咳可渴克刻客课肯啃垦恳坑吭空恐孔控抠口扣寇枯哭窟苦酷库裤夸垮挎跨胯块筷侩快宽款匡筐狂框矿眶旷况亏盔岿窥葵奎魁傀馈愧溃坤昆捆困括扩廓阔鲲", "L": "垃拉喇蜡腊辣啦莱来赖蓝婪栏拦篮阑兰澜谰揽览懒缆烂滥琅榔狼廊郎朗浪捞劳牢老佬姥酪烙涝勒乐雷镭蕾磊累儡垒擂肋类泪棱楞冷厘梨犁黎篱狸离漓理李里鲤礼莉荔吏栗丽厉励砾历利傈例俐痢立粒沥隶力璃哩俩联莲连镰廉怜涟帘敛脸链恋炼练粮凉梁粱良两辆量晾亮谅撩聊僚疗燎寥辽潦了撂镣廖料列裂烈劣猎琳林磷霖临邻鳞淋凛赁吝拎玲菱零龄铃伶羚凌灵陵岭领另令溜琉榴硫馏留刘瘤流柳六龙聋咙笼窿隆垄拢陇楼娄搂篓漏陋芦卢颅庐炉掳卤虏鲁麓碌露路赂鹿潞禄录陆戮驴吕铝侣旅履屡缕虑氯律率滤绿峦挛孪滦卵乱掠略抡轮伦仑沦纶论萝螺罗逻锣箩骡裸落洛骆络", "M": "妈麻玛码蚂马骂嘛吗埋买麦卖迈脉瞒馒蛮满蔓曼慢漫谩芒茫盲氓忙莽猫茅锚毛矛铆卯茂冒帽貌贸么玫枚梅酶霉煤没眉媒镁每美昧寐妹媚门闷们萌蒙檬盟锰猛梦孟眯醚靡糜迷谜弥米秘觅泌蜜密幂棉眠绵冕免勉娩缅面苗描瞄藐秒渺庙妙蔑灭民抿皿敏悯闽明螟鸣铭名命谬摸摹蘑模膜磨摩魔抹末莫墨默沫漠寞陌谋牟某拇牡亩姆母墓暮幕募慕木目睦牧穆芈", "N": "拿哪呐钠那娜纳氖乃奶耐奈南男难囊挠脑恼闹淖呢馁内嫩能妮霓倪泥尼拟你匿腻逆溺蔫拈年碾撵捻念娘酿鸟尿捏聂孽啮镊镍涅您柠狞凝宁拧泞牛扭钮纽脓浓农弄奴努怒女暖虐疟挪懦糯诺吒", "O": "哦欧鸥殴藕呕偶沤", "P": "啪趴爬帕怕琶拍排牌徘湃派攀潘盘磐盼畔判叛乓庞旁耪胖抛咆刨炮袍跑泡呸胚培裴赔陪配佩沛喷盆砰抨烹澎彭蓬棚硼篷膨朋鹏捧碰坯砒霹批披劈琵毗啤脾疲皮匹痞僻屁譬篇偏片骗飘漂瓢票撇瞥拼频贫品聘乒坪苹萍平凭瓶评屏坡泼颇婆破魄迫粕剖扑铺仆莆葡菩蒲埔朴圃普浦谱曝瀑", "Q": "期欺栖戚妻七凄漆柒沏其棋奇歧畦崎脐齐旗祈祁骑起岂乞企启契砌器气迄弃汽泣讫掐恰洽牵扦钎铅千迁签仟谦乾黔钱钳前潜遣浅谴堑嵌欠歉枪呛腔羌墙蔷强抢橇锹敲悄桥瞧乔侨巧鞘撬翘峭俏窍切茄且怯窃钦侵亲秦琴勤芹擒禽寝沁青轻氢倾卿清擎晴氰情顷请庆琼穷秋丘邱球求囚酋泅趋区蛆曲躯屈驱渠取娶龋趣去圈颧权醛泉全痊拳犬券劝缺炔瘸却鹊榷确雀裙群穹", "R": "然燃冉染瓤壤攘嚷让饶扰绕惹热壬仁人忍韧任认刃妊纫扔仍日戎茸蓉荣融熔溶容绒冗揉柔肉茹蠕儒孺如辱乳汝入褥软阮蕊瑞锐闰润若弱", "S": "撒洒萨腮鳃塞赛三叁伞散桑嗓丧搔骚扫嫂瑟色涩森僧莎砂杀刹沙纱傻啥煞筛晒珊苫杉山删煽衫闪陕擅赡膳善汕扇缮墒伤商赏晌上尚裳梢捎稍烧芍勺韶少哨邵绍奢赊蛇舌舍赦摄射慑涉社设砷申呻伸身深娠绅神沈审婶甚肾慎渗声生甥牲升绳省盛剩胜圣师失狮施湿诗尸虱十石拾时什食蚀实识史矢使屎驶始式示士世柿事拭誓逝势是嗜噬适仕侍释饰氏市恃室视试收手首守寿授售受瘦兽蔬枢梳殊抒输叔舒淑疏书赎孰熟薯暑曙署蜀黍鼠属术述树束戍竖墅庶数漱恕刷耍摔衰甩帅栓拴霜双爽谁水睡税吮瞬顺舜说硕朔烁斯撕嘶思私司丝死肆寺嗣四伺似饲巳松耸怂颂送宋讼诵搜艘擞嗽苏酥俗素速粟僳塑溯宿诉肃酸蒜算虽隋随绥髓碎岁穗遂隧祟孙损笋蓑梭唆缩琐索锁所", "T": "塌他它她塔獭挞蹋踏胎苔抬台泰酞太态汰坍摊贪瘫滩坛檀痰潭谭谈坦毯袒碳探叹炭汤塘搪堂棠膛唐糖倘躺淌趟烫掏涛滔绦萄桃逃淘陶讨套特藤腾疼誊梯剔踢锑提题蹄啼体替嚏惕涕剃屉天添填田甜恬舔腆挑条迢眺跳贴铁帖厅听烃汀廷停亭庭挺艇通桐酮瞳同铜彤童桶捅筒统痛偷投头透凸秃突图徒途涂屠土吐兔湍团推颓腿蜕褪退吞屯臀拖托脱鸵陀驮驼椭妥拓唾", "W": "挖哇蛙洼娃瓦袜歪外豌弯湾玩顽丸烷完碗挽晚皖惋宛婉万腕汪王亡枉网往旺望忘妄威巍微危韦违桅围唯惟为潍维苇萎委伟伪尾纬未蔚味畏胃喂魏位渭谓尉慰卫瘟温蚊文闻纹吻稳紊问嗡翁瓮挝蜗涡窝我斡卧握沃巫呜钨乌污诬屋无芜梧吾吴毋武五捂午舞伍侮坞戊雾晤物勿务悟误", "X": "昔熙析西硒矽晰嘻吸锡牺稀息希悉膝夕惜熄烯溪汐犀檄袭席习媳喜铣洗系隙戏细瞎虾匣霞辖暇峡侠狭下厦夏吓掀锨先仙鲜纤咸贤衔舷闲涎弦嫌显险现献县腺馅羡宪陷限线相厢镶香箱襄湘乡翔祥详想响享项巷橡像向象萧硝霄削哮嚣销消宵淆晓小孝校肖啸笑效楔些歇蝎鞋协挟携邪斜胁谐写械卸蟹懈泄泻谢屑薪芯锌欣辛新忻心信衅星腥猩惺兴刑型形邢行醒幸杏性姓兄凶胸匈汹雄熊休修羞朽嗅锈秀袖绣墟戌需虚嘘须徐许蓄酗叙旭序畜恤絮婿绪续轩喧宣悬旋玄选癣眩绚靴薛学穴雪血勋熏循旬询寻驯巡殉汛训讯逊迅", "Y": "压押鸦鸭呀丫芽牙蚜崖衙涯雅哑亚讶焉咽阉烟淹盐严研蜒岩延言颜阎炎沿奄掩眼衍演艳堰燕厌砚雁唁彦焰宴谚验殃央鸯秧杨扬佯疡羊洋阳氧仰痒养样漾邀腰妖瑶摇尧遥窑谣姚咬舀药要耀椰噎耶爷野冶也页掖业叶曳腋夜液一壹医揖铱依伊衣颐夷遗移仪胰疑沂宜姨彝椅蚁倚已乙矣以艺抑易邑屹亿役臆逸肄疫亦裔意毅忆义益溢诣议谊译异翼翌绎茵荫因殷音阴姻吟银淫寅饮尹引隐印英樱婴鹰应缨莹萤营荧蝇迎赢盈影颖硬映哟拥佣臃痈庸雍踊蛹咏泳涌永恿勇用幽优悠忧尤由邮铀犹油游酉有友右佑釉诱又幼迂淤于盂榆虞愚舆余俞逾鱼愉渝渔隅予娱雨与屿禹宇语羽玉域芋郁吁遇喻峪御愈欲狱育誉浴寓裕预豫驭鸳渊冤元垣袁原援辕园员圆猿源缘远苑愿怨院曰约越跃钥岳粤月悦阅耘云郧匀陨允运蕴酝晕韵孕琊", "Z": "匝砸杂栽哉灾宰载再在咱攒暂赞赃脏葬遭糟凿藻枣早澡蚤躁噪造皂灶燥责择则泽贼怎增憎曾赠扎喳渣札轧铡闸眨栅榨咋乍炸诈摘斋宅窄债寨瞻毡詹粘沾盏斩辗崭展蘸栈占战站湛绽樟章彰漳张掌涨杖丈帐账仗胀瘴障招昭找沼赵照罩兆肇召遮折哲蛰辙者锗蔗这浙珍斟真甄砧臻贞针侦枕疹诊震振镇阵蒸挣睁征狰争怔整拯正政帧症郑证芝枝支吱蜘知肢脂汁之织职直植殖执值侄址指止趾只旨纸志挚掷至致置帜峙制智秩稚质炙痔滞治窒中盅忠钟衷终种肿重仲众舟周州洲诌粥轴肘帚咒皱宙昼骤珠株蛛朱猪诸诛逐竹烛煮拄瞩嘱主著柱助蛀贮铸筑住注祝驻抓爪拽专砖转撰赚篆桩庄装妆撞壮状椎锥追赘坠缀谆准捉拙卓桌琢茁酌啄着灼浊兹咨资姿滋淄孜紫仔籽滓子自渍字鬃棕踪宗综总纵邹走奏揍租足卒族祖诅阻组钻纂嘴醉最罪尊遵昨左佐柞做作坐座"};
  var CHAR_PY_MAP = {};
  (function initPyMap() {
    var letters = Object.keys(PY_TABLE);
    for (var i = 0; i < letters.length; i++) {
      var L = letters[i];
      var str = PY_TABLE[L];
      for (var j = 0; j < str.length; j++) {
        CHAR_PY_MAP[str.charAt(j)] = L;
      }
    }
  })();

  function getCharPy(ch) {
    if (!ch) return '';
    if (/[a-zA-Z0-9]/.test(ch)) return ch.toUpperCase();
    return CHAR_PY_MAP[ch] || '';
  }

  function getTitleInitials(title) {
    var s = String(title || '');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var p = getCharPy(s.charAt(i));
      if (p) out += p;
      if (out.length >= 14) break;
    }
    return out;
  }

  // 暴露给全局，供 app.js 共享精准拼音首字母能力
  window.__xlPyInitials = getTitleInitials;

  /* ---------------- 3. 纯本地 SVG 二维码生成器 (ISO/IEC 18004 Level-L, 零外链依赖) ---------------- */
  function makeQrSvg(text, size) {
    try {
      var utf8 = [];
      for (var i = 0; i < text.length; i++) {
        var c = text.charCodeAt(i);
        if (c < 0x80) utf8.push(c);
        else if (c < 0x800) utf8.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        else utf8.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
      var VTAB = [
        null,
        [1, 26, 7, 1, []],
        [2, 44, 10, 1, [6, 18]],
        [3, 70, 15, 1, [6, 22]],
        [4, 100, 20, 1, [6, 26]],
        [5, 134, 26, 1, [6, 30]],
        [6, 172, 18, 2, [6, 34]]
      ];
      var ver = 1, spec = null;
      for (var v = 1; v <= 6; v++) {
        var cap = VTAB[v][1] - VTAB[v][2] * VTAB[v][3] - 2;
        if (utf8.length <= cap) { ver = v; spec = VTAB[v]; break; }
      }
      if (!spec) { ver = 6; spec = VTAB[6]; utf8 = utf8.slice(0, 134); }
      var totalCw = spec[1], ecLen = spec[2], numBlocks = spec[3], align = spec[4];
      var dataCw = totalCw - ecLen * numBlocks;

      var bits = [];
      function pushBits(val, len) {
        for (var b = len - 1; b >= 0; b--) bits.push((val >> b) & 1);
      }
      pushBits(4, 4);
      pushBits(utf8.length, 8);
      for (var m = 0; m < utf8.length; m++) pushBits(utf8[m], 8);
      var maxBits = dataCw * 8;
      pushBits(0, Math.min(4, maxBits - bits.length));
      while (bits.length % 8 !== 0) bits.push(0);
      var pad = [0xec, 0x11], pi = 0;
      while (bits.length < maxBits) { pushBits(pad[pi % 2], 8); pi++; }

      var dataBytes = [];
      for (var db = 0; db < bits.length; db += 8) {
        var byt = 0;
        for (var bit = 0; bit < 8; bit++) byt = (byt << 1) | bits[db + bit];
        dataBytes.push(byt);
      }

      var EXP = new Array(512), LOG = new Array(256);
      var x = 1;
      for (var e = 0; e < 255; e++) { EXP[e] = x; LOG[x] = e; x <<= 1; if (x & 0x100) x ^= 0x11d; }
      for (var e2 = 255; e2 < 512; e2++) EXP[e2] = EXP[e2 - 255];
      function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }
      var gen = [1];
      for (var g = 0; g < ecLen; g++) {
        var next = [];
        for (var k = 0; k < gen.length + 1; k++) next.push(0);
        for (var j = 0; j < gen.length; j++) {
          next[j] ^= gen[j];
          next[j + 1] ^= gfMul(gen[j], EXP[g]);
        }
        gen = next;
      }
      function rsEncode(msg) {
        var rem = [];
        for (var k = 0; k < ecLen; k++) rem.push(0);
        for (var i2 = 0; i2 < msg.length; i2++) {
          var factor = msg[i2] ^ rem[0];
          rem.shift(); rem.push(0);
          if (factor !== 0) {
            for (var j2 = 0; j2 < ecLen; j2++) rem[j2] ^= gfMul(gen[j2 + 1], factor);
          }
        }
        return rem;
      }

      var blocks = [], ecBlocks = [], blockSize = Math.floor(dataCw / numBlocks), offset = 0;
      for (var blkIdx = 0; blkIdx < numBlocks; blkIdx++) {
        var blk = dataBytes.slice(offset, offset + blockSize);
        offset += blockSize;
        blocks.push(blk);
        ecBlocks.push(rsEncode(blk));
      }
      var finalBytes = [];
      for (var cw = 0; cw < blockSize; cw++) for (var b1 = 0; b1 < numBlocks; b1++) finalBytes.push(blocks[b1][cw]);
      for (var ec = 0; ec < ecLen; ec++) for (var b2 = 0; b2 < numBlocks; b2++) finalBytes.push(ecBlocks[b2][ec]);

      var N = ver * 4 + 17;
      var grid = [], isFunc = [];
      for (var r = 0; r < N; r++) {
        var gr = [], fr = [];
        for (var col = 0; col < N; col++) { gr.push(0); fr.push(false); }
        grid.push(gr); isFunc.push(fr);
      }
      function setMod(r0, c0, val) {
        if (r0 >= 0 && r0 < N && c0 >= 0 && c0 < N) {
          grid[r0][c0] = val ? 1 : 0;
          isFunc[r0][c0] = true;
        }
      }
      function finder(Row, Col) {
        for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
          var v0 = (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) &&
            (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
          setMod(Row + dr, Col + dc, v0);
        }
      }
      finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
      for (var t = 8; t < N - 8; t++) { setMod(6, t, t % 2 === 0); setMod(t, 6, t % 2 === 0); }
      for (var ai = 0; ai < align.length; ai++) for (var aj = 0; aj < align.length; aj++) {
        var ar = align[ai], ac = align[aj];
        if ((ar === 6 && ac === 6) || (ar === 6 && ac === N - 7) || (ar === N - 7 && ac === 6)) continue;
        for (var dr2 = -2; dr2 <= 2; dr2++) for (var dc2 = -2; dc2 <= 2; dc2++) {
          setMod(ar + dr2, ac + dc2, Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1);
        }
      }
      setMod(N - 8, 8, 1);
      for (var f1 = 0; f1 < 9; f1++) { if (f1 !== 6) { isFunc[8][f1] = true; isFunc[f1][8] = true; } }
      for (var f2 = 0; f2 < 8; f2++) { isFunc[8][N - 1 - f2] = true; isFunc[N - 1 - f2][8] = true; }

      var allBits = [];
      for (var fb = 0; fb < finalBytes.length; fb++) for (var bit2 = 7; bit2 >= 0; bit2--) allBits.push((finalBytes[fb] >> bit2) & 1);
      var bi = 0, up = true;
      for (var right = N - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (var vert = 0; vert < N; vert++) {
          var r2 = up ? (N - 1 - vert) : vert;
          for (var j3 = 0; j3 < 2; j3++) {
            var c2 = right - j3;
            if (!isFunc[r2][c2]) {
              var dark = bi < allBits.length ? allBits[bi++] : 0;
              if ((r2 + c2) % 2 === 0) dark ^= 1;
              grid[r2][c2] = dark;
            }
          }
        }
        up = !up;
      }
      var fmt = 0x77c4;
      for (var fi = 0; fi <= 5; fi++) setMod(8, fi, (fmt >> fi) & 1);
      setMod(8, 7, (fmt >> 6) & 1); setMod(8, 8, (fmt >> 7) & 1); setMod(7, 8, (fmt >> 8) & 1);
      for (var fi2 = 9; fi2 < 15; fi2++) setMod(14 - fi2, 8, (fmt >> fi2) & 1);
      for (var fi3 = 0; fi3 < 8; fi3++) setMod(8, N - 1 - fi3, (fmt >> fi3) & 1);
      for (var fi4 = 8; fi4 < 15; fi4++) setMod(N - 15 + fi4, 8, (fmt >> fi4) & 1);

      var path = '';
      for (var rowIdx = 0; rowIdx < N; rowIdx++) for (var colIdx = 0; colIdx < N; colIdx++) {
        if (grid[rowIdx][colIdx]) path += 'M' + (colIdx + 2) + ',' + (rowIdx + 2) + 'h1v1h-1z';
      }
      var total = N + 4;
      return '<svg viewBox="0 0 ' + total + ' ' + total + '" width="' + (size || 86) + '" height="' + (size || 86) + '" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff" rx="2"/><path d="' + path + '" fill="#060a14"/></svg>';
    } catch (e) {
      return '';
    }
  }

  var FOCUSED_CLS = 'tv-f';
  var heroDetailCache = new Map();
  var heroFetchTimer = null;
  var currentHeroHref = '';
  var osdHideTimer = null;
  var hintHideTimer = null;
  var hudHideTimer = null;
  var tvPollTimer = null;
  var lastSyncedTs = 0;
  var cachedTvSources = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').trim();
  }

  function getHooks() {
    return window.XLTV || {};
  }

  /* 机顶盒自愈获取源列表: 即使 app.js 尚未完成初始化，tv.js 也能独立拉取 /api/config */
  function ensureTvSources() {
    var hooks = getHooks();
    if (hooks && typeof hooks.visibleSources === 'function') {
      var list = hooks.visibleSources();
      if (list && list.length) {
        cachedTvSources = list;
        return Promise.resolve(list);
      }
    }
    if (cachedTvSources && cachedTvSources.length) {
      return Promise.resolve(cachedTvSources);
    }
    if (window.API && typeof window.API.getConfig === 'function') {
      return window.API.getConfig().then(function (cfg) {
        cachedTvSources = (cfg && cfg.sources) || [];
        return cachedTvSources;
      }).catch(function () { return []; });
    }
    return Promise.resolve([]);
  }

  function buildTvCardHtml(item) {
    var hooks = getHooks();
    if (hooks && typeof hooks.cardHtml === 'function') {
      return hooks.cardHtml(item);
    }
    var href = '#/play/' + esc(item.sourceKey) + '/' + encodeURIComponent(item.id) + '?ep=0&group=0';
    return '<a class="card" href="' + href + '">' +
      '<div class="card-poster">' +
      '  <img loading="lazy" referrerpolicy="no-referrer" src="' + esc(item.pic) + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
      '  <span class="card-badge">' + esc(item.remarks || item.year || '') + '</span>' +
      '</div>' +
      '<div class="card-name">' + esc(item.title) + '</div>' +
      '<div class="card-sub">' + esc(item.year || '') + (item.typeName ? ' · ' + esc(item.typeName) : '') + '</div>' +
      (item.sourceName ? '<div class="card-src">' + esc(item.sourceName) + '</div>' : '') +
      '</a>';
  }

  /* ---------------- 4. 严格网格行列索引 + 空间焦点导航引擎 (彻底解决遥控器按“下”变“右”错乱) ---------------- */
  var navAutoSwitchTimer = null;
  var liveGroupAutoTimer = null;

  function visible(el) {
    if (!el || el.disabled || (el.getAttribute && el.getAttribute('aria-hidden') === 'true')) return false;
    if (el.classList && el.classList.contains('hidden')) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    var st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    if (el.offsetParent === null && st.position !== 'fixed' && st.position !== 'sticky') return false;
    return true;
  }

  function collectFocusable(scopeRoot) {
    var root = scopeRoot || document;
    var kbMask = document.getElementById('tvModalKbMask');
    if (!scopeRoot && kbMask && !kbMask.classList.contains('hidden')) {
      root = kbMask;
    } else if (!scopeRoot) {
      var modal = document.querySelector('.modal-mask:not(.hidden)');
      if (modal) root = modal;
      else if (document.body.classList.contains('tv-playing') && document.body.classList.contains('tv-fs-mode')) {
        var osd = document.getElementById('tvPlayerOsd');
        if (osd && osd.classList.contains('open')) root = osd;
        else return [];
      }
    }

    var list = root.querySelectorAll('a[href],button,input,select,[tabindex]:not([tabindex="-1"])');
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!visible(el)) continue;
      if (el.id === 'vkbBox' || el.closest('#vkbBox')) continue;
      out.push(el);
    }
    return out;
  }

  function center(r) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* 获取页面上所有可见的 4 列影片网格容器 */
  function getAllVisibleCardGrids() {
    var rawGrids = document.querySelectorAll('#view .grid, #tvsResultGrid, #tvPlayRelGrid');
    var out = [];
    for (var i = 0; i < rawGrids.length; i++) {
      var g = rawGrids[i];
      if (!visible(g)) continue;
      var cards = [];
      var cList = g.querySelectorAll('.card');
      for (var j = 0; j < cList.length; j++) {
        if (visible(cList[j])) cards.push(cList[j]);
      }
      if (cards.length > 0) out.push({ grid: g, cards: cards });
    }
    return out;
  }

  function pickNext(cur, dir, scopeRoot) {
    var all = collectFocusable(scopeRoot);
    if (!all.length) return null;
    if (!cur || !visible(cur)) return all[0];

    // 规则 A: 顶栏导航栏 (#mainNav a 与 #tvMyEntry) 严格线性/下跳控制
    var inTopbar = cur.closest && cur.closest('#topbar');
    if (inTopbar && !scopeRoot) {
      var topItems = [];
      var navLinks = document.querySelectorAll('#mainNav a');
      for (var ni = 0; ni < navLinks.length; ni++) {
        if (visible(navLinks[ni])) topItems.push(navLinks[ni]);
      }
      var myBtn = document.getElementById('tvMyEntry');
      if (myBtn && visible(myBtn)) topItems.push(myBtn);

      var tIdx = topItems.indexOf(cur);
      if (tIdx >= 0) {
        if (dir === 'left') return tIdx > 0 ? topItems[tIdx - 1] : topItems[0];
        if (dir === 'right') return tIdx < topItems.length - 1 ? topItems[tIdx + 1] : topItems[topItems.length - 1];
        if (dir === 'up') return cur;
        if (dir === 'down') {
          // 从顶栏按下键：优先进入搜索页键盘、巨幕播放按钮、直播分类或第一张海报卡
          var firstKb = document.querySelector('#tvsKbFull button');
          if (firstKb && visible(firstKb)) return firstKb;
          var heroPlay = document.getElementById('tahPlayBtn');
          if (heroPlay && visible(heroPlay)) return heroPlay;
          var tvFsBtn = document.getElementById('tvBtnFs');
          if (tvFsBtn && visible(tvFsBtn)) return tvFsBtn;
          var liveGrpOn = document.querySelector('#liveGroups .live-group-btn.on') || document.querySelector('#liveGroups .live-group-btn');
          if (liveGrpOn && visible(liveGrpOn)) return liveGrpOn;
          var firstCard = document.querySelector('#view .card');
          if (firstCard && visible(firstCard)) return firstCard;
        }
      }
    }

    // 规则 B: 首页/分类页巨幕按钮 (#tahPlayBtn / #tahSearchBtn) 严格上下左右控制
    var inHero = cur.closest && cur.closest('#tvAuroraHero');
    if (inHero && !scopeRoot) {
      var pBtn = document.getElementById('tahPlayBtn');
      var sBtn = document.getElementById('tahSearchBtn');
      if (dir === 'left' && cur === sBtn && pBtn && visible(pBtn)) return pBtn;
      if (dir === 'right' && cur === pBtn && sBtn && visible(sBtn)) return sBtn;
      if (dir === 'up') {
        return document.querySelector('#mainNav a.active') || document.querySelector('#mainNav a') || cur;
      }
      if (dir === 'down') {
        var grids0 = getAllVisibleCardGrids();
        if (grids0.length && grids0[0].cards.length) return grids0[0].cards[0];
      }
    }

    // 规则 C: 4 列影片网格 (.card) 严格矩阵索引导航 (左-1，右+1，上-4，下+4，100% 不串行！)
    if (cur.classList && cur.classList.contains('card') && !scopeRoot) {
      var grids = getAllVisibleCardGrids();
      for (var gi = 0; gi < grids.length; gi++) {
        var cards = grids[gi].cards;
        var cIdx = cards.indexOf(cur);
        if (cIdx === -1) continue;

        var COLS = 4;
        var col = cIdx % COLS;

        if (dir === 'right') {
          if (col < COLS - 1 && cIdx + 1 < cards.length) {
            return cards[cIdx + 1];
          }
          return cur; // 行末按右不再乱跳到下一行
        }
        if (dir === 'left') {
          if (col > 0 && cIdx - 1 >= 0) {
            return cards[cIdx - 1];
          }
          // 若在搜索页结果网格第一列按左键，跳回中间联想词或左侧字母键盘
          if (grids[gi].grid.id === 'tvsResultGrid') {
            var sug0 = document.querySelector('#tvsSugList .tvs-sug-btn');
            if (sug0 && visible(sug0)) return sug0;
            var kb0 = document.querySelector('#tvsKbFull button');
            if (kb0 && visible(kb0)) return kb0;
          }
          return cur;
        }
        if (dir === 'down') {
          if (cIdx + COLS < cards.length) {
            return cards[cIdx + COLS];
          }
          // 若当前行是本网格倒数第二行但最后一排不足4个，跳到本网格最后一个卡片
          var curRow = Math.floor(cIdx / COLS);
          var lastRow = Math.floor((cards.length - 1) / COLS);
          if (curRow < lastRow) {
            return cards[cards.length - 1];
          }
          // 跳到下一个分类区块网格的同列卡片
          if (gi + 1 < grids.length) {
            var nextCards = grids[gi + 1].cards;
            return nextCards[Math.min(col, nextCards.length - 1)];
          }
          return cur;
        }
        if (dir === 'up') {
          if (cIdx - COLS >= 0) {
            return cards[cIdx - COLS];
          }
          // 当前网格第一排按上键：若有上一个网格则跳到上一个网格底排同列，否则回到巨幕按钮或顶栏
          if (gi > 0) {
            var prevCards = grids[gi - 1].cards;
            var prevLastRowStart = Math.floor((prevCards.length - 1) / COLS) * COLS;
            return prevCards[Math.min(prevLastRowStart + col, prevCards.length - 1)];
          }
          var heroBtn = document.getElementById('tahPlayBtn');
          if (heroBtn && visible(heroBtn)) return heroBtn;
          var tvCtrlBtn = document.getElementById('tvBtnFs');
          if (tvCtrlBtn && visible(tvCtrlBtn)) return tvCtrlBtn;
          return document.querySelector('#mainNav a.active') || document.querySelector('#mainNav a') || cur;
        }
      }
    }

    // 规则 D: 搜索页左侧 6列×5行 A-Z 全键盘 (#tvsKbFull) 严格矩阵控制
    var inKbFull = cur.closest && cur.closest('#tvsKbFull');
    if (inKbFull && !scopeRoot) {
      var kbBtns = [];
      var rawKb = document.querySelectorAll('#tvsKbFull button');
      for (var ki = 0; ki < rawKb.length; ki++) {
        if (visible(rawKb[ki])) kbBtns.push(rawKb[ki]);
      }
      var kIdx = kbBtns.indexOf(cur);
      if (kIdx >= 0) {
        // 前 24 个是 A~X (4行×6列，索引 0..23)，第 5 行是 Y(24), Z(25), 退格(26,占2格), 清空(27,占2格)
        if (dir === 'left') {
          if (kIdx === 0 || kIdx === 6 || kIdx === 12 || kIdx === 18 || kIdx === 24) return cur;
          return kbBtns[kIdx - 1];
        }
        if (dir === 'right') {
          var isRightEdge = (kIdx === 5 || kIdx === 11 || kIdx === 17 || kIdx === 23 || kIdx === 27);
          if (isRightEdge) {
            var firstSug = document.querySelector('#tvsSugList .tvs-sug-btn');
            if (firstSug && visible(firstSug)) return firstSug;
            var firstRes = document.querySelector('#tvsResultGrid .card');
            if (firstRes && visible(firstRes)) return firstRes;
            return cur;
          }
          return kbBtns[kIdx + 1] || cur;
        }
        if (dir === 'up') {
          if (kIdx < 6) {
            return document.querySelector('#mainNav a.active') || document.querySelector('#mainNav a') || cur;
          }
          if (kIdx < 24) return kbBtns[kIdx - 6];
          // 第 5 行 (24=Y, 25=Z, 26=退格, 27=清空) 按上键回到第 4 行对应列
          if (kIdx === 24) return kbBtns[18]; // S
          if (kIdx === 25) return kbBtns[19]; // T
          if (kIdx === 26) return kbBtns[20]; // U
          return kbBtns[22]; // W
        }
        if (dir === 'down') {
          if (kIdx < 18) return kbBtns[kIdx + 6];
          if (kIdx < 24) {
            var cCol = kIdx - 18;
            if (cCol === 0) return kbBtns[24];
            if (cCol === 1) return kbBtns[25];
            if (cCol <= 3) return kbBtns[26];
            return kbBtns[27];
          }
          return cur; // 第 5 行按下键不再乱跳，因为二维码无需焦点
        }
      }
    }

    // 规则 E: 搜索页中栏猜你想搜列表 (#tvsSugList)
    var inSugList = cur.closest && cur.closest('#tvsSugList');
    if (inSugList && !scopeRoot) {
      var sugs = [];
      var rawSugs = document.querySelectorAll('#tvsSugList .tvs-sug-btn');
      for (var si = 0; si < rawSugs.length; si++) {
        if (visible(rawSugs[si])) sugs.push(rawSugs[si]);
      }
      var sIdx = sugs.indexOf(cur);
      if (sIdx >= 0) {
        if (dir === 'up') {
          if (sIdx > 0) return sugs[sIdx - 1];
          return document.querySelector('#mainNav a.active') || document.querySelector('#mainNav a') || cur;
        }
        if (dir === 'down') {
          return sIdx < sugs.length - 1 ? sugs[sIdx + 1] : cur;
        }
        if (dir === 'left') {
          var kbTarget = document.querySelector('#tvsKbFull button[data-char="F"]') || document.querySelector('#tvsKbFull button');
          if (kbTarget && visible(kbTarget)) return kbTarget;
        }
        if (dir === 'right') {
          var res0 = document.querySelector('#tvsResultGrid .card');
          if (res0 && visible(res0)) return res0;
        }
      }
    }

    // 规则 F: TV 播放页右侧 5 列选集网格 (.tvp-ep-grid) 严格矩阵控制
    var inEpGrid = cur.closest && cur.closest('#tvPlayEpGrid');
    if (inEpGrid && !scopeRoot) {
      var epBtns = [];
      var rawEps = document.querySelectorAll('#tvPlayEpGrid .tvp-ep-btn');
      for (var ei = 0; ei < rawEps.length; ei++) {
        if (visible(rawEps[ei])) epBtns.push(rawEps[ei]);
      }
      var eIdx = epBtns.indexOf(cur);
      if (eIdx >= 0) {
        var ECOLS = 5;
        var eCol = eIdx % ECOLS;
        if (dir === 'right') return (eCol < ECOLS - 1 && eIdx + 1 < epBtns.length) ? epBtns[eIdx + 1] : cur;
        if (dir === 'left') {
          if (eCol > 0) return epBtns[eIdx - 1];
          var fsBtn0 = document.getElementById('tvBtnFs');
          return (fsBtn0 && visible(fsBtn0)) ? fsBtn0 : cur;
        }
        if (dir === 'down') {
          if (eIdx + ECOLS < epBtns.length) return epBtns[eIdx + ECOLS];
          var rel0 = document.querySelector('#tvPlayRelGrid .card');
          return (rel0 && visible(rel0)) ? rel0 : cur;
        }
        if (dir === 'up') {
          if (eIdx - ECOLS >= 0) return epBtns[eIdx - ECOLS];
          var rangeOn = document.querySelector('#tvPlayEpRanges .tvp-range-btn.on') || document.querySelector('#tvPlayEpRanges .tvp-range-btn');
          if (rangeOn && visible(rangeOn)) return rangeOn;
          var srcOn = document.querySelector('#tvPlaySrcList .tvp-src-btn.current') || document.querySelector('#tvPlaySrcList .tvp-src-btn');
          if (srcOn && visible(srcOn)) return srcOn;
        }
      }
    }

    // 通用几何方向导航 (兜底处理其余按钮、弹窗键盘、直播页列表等)
    var cr = cur.getBoundingClientRect();
    var c = center(cr);
    var best = null;
    var bestScore = Infinity;

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === cur || el.contains(cur) || cur.contains(el)) continue;
      var r = el.getBoundingClientRect();
      var m = center(r);
      var dx = m.x - c.x;
      var dy = m.y - c.y;
      var pri, sec;

      if (dir === 'left') {
        if (dx >= -6) continue;
        pri = -dx;
        sec = Math.abs(dy);
      } else if (dir === 'right') {
        if (dx <= 6) continue;
        pri = dx;
        sec = Math.abs(dy);
      } else if (dir === 'up') {
        if (dy >= -6) continue;
        pri = -dy;
        sec = Math.abs(dx);
      } else {
        if (dy <= 6) continue;
        pri = dy;
        sec = Math.abs(dx);
      }

      var sameRowContainer = cur.parentElement && cur.parentElement === el.parentElement;
      if ((dir === 'left' || dir === 'right') && sec > Math.max(pri * 1.4, 90)) continue;
      if ((dir === 'up' || dir === 'down') && sec > Math.max(pri * 2.2, 260)) continue;

      var score = pri + sec * (sameRowContainer ? 1.8 : 2.5);
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best;
  }

  function setFocus(el, noScroll) {
    if (!el) return;
    try {
      var prevs = document.querySelectorAll('.' + FOCUSED_CLS);
      for (var i = 0; i < prevs.length; i++) prevs[i].classList.remove(FOCUSED_CLS);
    } catch (e) {}

    el.classList.add(FOCUSED_CLS);
    try {
      if (el.tagName !== 'INPUT') el.focus({ preventScroll: true });
    } catch (e) {
      try { if (el.tagName !== 'INPUT') el.focus(); } catch (e2) {}
    }

    if (!noScroll) {
      try {
        // 搜索页左栏/中栏固定不滚动
        var inFixedSearchCol = el.closest && (el.closest('.tvs-left-panel') || el.closest('.tvs-mid-panel') || el.closest('#topbar'));
        if (!inFixedSearchCol) {
          var r = el.getBoundingClientRect();
          if (r.top < 90 || r.bottom > window.innerHeight - 50) {
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          }
        }
      } catch (e) {
        try { el.scrollIntoView(); } catch (e2) {}
      }
    }

    if (el.classList && el.classList.contains('card')) {
      updateAuroraHeroFromCard(el);
    }

    // 【问题 2.2 修复】：遥控器移动焦点到顶部导航（搜索/精选/电影/剧集/综艺/动漫/直播）自动确认切换频道，无需再按一次 OK 键！
    clearTimeout(navAutoSwitchTimer);
    if (el.closest && el.closest('#mainNav')) {
      var targetHref = el.getAttribute('data-href') || el.getAttribute('href') || '';
      if (targetHref) {
        navAutoSwitchTimer = setTimeout(function () {
          if (!el.classList.contains(FOCUSED_CLS)) return;
          var curHash = '#/' + ((location.hash || '#/home').replace(/^#\/?/, '').split('?')[0] || 'home');
          var decCur = curHash;
          var decTar = targetHref;
          try { decCur = decodeURIComponent(curHash); } catch (e) {}
          try { decTar = decodeURIComponent(targetHref); } catch (e) {}
          if (decCur !== decTar) {
            location.hash = targetHref;
          }
        }, 180);
      }
    }

    // 电视直播页：遥控器上下移动到左侧「频道分类」按钮时，自动切换展示对应分类的频道列表
    clearTimeout(liveGroupAutoTimer);
    if (el.classList && el.classList.contains('live-group-btn')) {
      liveGroupAutoTimer = setTimeout(function () {
        if (el.classList.contains(FOCUSED_CLS) && !el.classList.contains('on')) {
          el.click();
          setFocus(el, true);
        }
      }, 160);
    }
  }

  /* ---------------- 5. 顶栏改造: 永久删除公告栏 + 极简频道胶囊 + 右侧「👤 我的 | 13:20」 ---------------- */
  function tuneTopbar() {
    var oldLegend = document.getElementById('tvLegend');
    if (oldLegend) oldLegend.remove();

    // 【问题 1.2 修复】：永久删除并隐藏 TV 端的顶部公告栏 (#announceBar)
    var annBar = document.getElementById('announceBar');
    if (annBar) {
      annBar.classList.add('hidden');
      annBar.style.display = 'none';
    }

    var nav = document.getElementById('mainNav');
    if (nav) {
      var tvChannels = [
        ['#/search', '🔍 搜索'],
        ['#/home', '精选'],
        ['#/browse/电影', '电影'],
        ['#/browse/剧集', '剧集'],
        ['#/browse/综艺', '综艺'],
        ['#/browse/动漫', '动漫'],
        ['#/live', '直播']
      ];
      var curHash = '#/' + ((location.hash || '#/home').replace(/^#\/?/, '').split('?')[0] || 'home');
      var decodedHash = curHash;
      try { decodedHash = decodeURIComponent(curHash); } catch (e) {}

      if (nav.dataset.tvTuned !== '1') {
        nav.dataset.tvTuned = '1';
        nav.innerHTML = tvChannels.map(function (item) {
          return '<a href="' + item[0] + '" data-href="' + item[0] + '">' + item[1] + '</a>';
        }).join('');
      }
      var links = nav.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var dh = a.getAttribute('data-href') || '';
        var isAct = decodedHash === dh || (dh !== '#/home' && decodedHash.indexOf(dh) === 0);
        a.classList.toggle('active', isAct);
      }
    }

    var topRight = document.querySelector('.topbar-right');
    if (topRight) {
      var tvRight = document.getElementById('tvTopRight');
      if (!tvRight) {
        tvRight = document.createElement('div');
        tvRight.id = 'tvTopRight';
        tvRight.innerHTML =
          '<a id="tvMyEntry" href="#/user">👤 我的</a>' +
          '<span id="tvClock">--:--</span>';
        topRight.appendChild(tvRight);
      }
      var myEntry = document.getElementById('tvMyEntry');
      var hooks = getHooks();
      var st = hooks.getState ? hooks.getState() : null;
      var me = st && st.me ? st.me : null;
      if (!me) {
        try {
          var rawMe = localStorage.getItem('ntv:cached_me');
          if (rawMe) me = JSON.parse(rawMe);
        } catch (e) {}
      }
      if (myEntry) {
        myEntry.href = me ? '#/user' : '#/login';
        myEntry.textContent = me ? ('👤 ' + String(me).slice(0, 8)) : '👤 我的';
        var h = location.hash || '';
        myEntry.classList.toggle('active', h.indexOf('#/user') === 0 || h.indexOf('#/login') === 0);
      }
      updateClock();
    }
  }

  function updateClock() {
    var el = document.getElementById('tvClock');
    if (!el) return;
    var d = new Date();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    el.textContent = hh + ':' + mm;
  }
  setInterval(updateClock, 10000);

  /* ---------------- 6. 首页与分类页: 极光联动巨幕 & 每排 4 部影片对齐修整 ---------------- */
  function isHomeOrBrowse() {
    var h = location.hash || '#/home';
    return h === '' || h === '#' || h === '#/' || h.indexOf('#/home') === 0 || h.indexOf('#/browse') === 0;
  }

  /* 将首页每个分类行的卡片裁剪为 4 的整数倍(8 或 12 部)，保证每排严格 4 个绝不缺角 */
  function normalizeGridCardsToFour() {
    if (!isHomeOrBrowse()) return;
    var rowGrids = document.querySelectorAll('#rows .grid');
    for (var i = 0; i < rowGrids.length; i++) {
      var g = rowGrids[i];
      var cards = g.querySelectorAll('.card');
      if (cards.length > 8) {
        var keep = cards.length >= 12 ? 12 : 8;
        for (var j = keep; j < cards.length; j++) {
          cards[j].style.display = 'none';
        }
      }
    }
  }

  function ensureAuroraHero() {
    if (!isHomeOrBrowse()) return null;
    var view = document.getElementById('view');
    if (!view || view.dataset.tvSearch === '1') return null;

    var container = view.querySelector('.container');
    if (!container) return null;

    normalizeGridCardsToFour();

    var hero = document.getElementById('tvAuroraHero');
    if (!hero) {
      hero = document.createElement('div');
      hero.id = 'tvAuroraHero';
      hero.innerHTML =
        '<div class="tah-bg-blur" id="tahBgBlur"></div>' +
        '<div class="tah-bg-main" id="tahBgMain"></div>' +
        '<div class="tah-vignette"></div>' +
        '<div class="tah-content">' +
        '  <div class="tah-title" id="tahTitle">晓林影视 · 极光大屏影院</div>' +
        '  <div class="tah-tags" id="tahTags">' +
        '    <span class="tah-tag tah-4k">4K HDR</span>' +
        '    <span class="tah-tag">杜比视界</span>' +
        '    <span class="tah-tag">遥控器焦点联动预览</span>' +
        '  </div>' +
        '  <div class="tah-desc" id="tahDesc">使用遥控器方向键移动焦点至下方任意影片海报，大屏将实时预览影片背景与剧情简介，按 OK 键直接进入播放。</div>' +
        '  <div class="tah-actions">' +
        '    <a class="tah-play-btn" id="tahPlayBtn" href="#/home">▶ 立即播放</a>' +
        '    <a class="tah-sub-btn" id="tahSearchBtn" href="#/search">🔍 首字母/扫码搜片</a>' +
        '  </div>' +
        '</div>';
      container.insertBefore(hero, container.firstChild);
    }

    var firstCard = view.querySelector('.card');
    if (firstCard && (!currentHeroHref || currentHeroHref === '#/home')) {
      updateAuroraHeroFromCard(firstCard);
    }
    return hero;
  }

  /* 机顶盒自愈直连加载器 */
  var fallbackLoading = false;
  function checkAndFallbackLoadMovies() {
    if (!isHomeOrBrowse() || fallbackLoading) return;
    var view = document.getElementById('view');
    if (!view || view.dataset.tvSearch === '1') return;
    var existingCards = view.querySelectorAll('.card');
    if (existingCards.length > 0) return;

    fallbackLoading = true;
    var h = location.hash || '#/home';
    var catName = '精选推荐';
    var isBrowse = h.indexOf('#/browse/') === 0;
    if (isBrowse) {
      try {
        catName = decodeURIComponent(h.replace(/^#\/browse\//, '').split('?')[0]) || '电影';
      } catch (e) { catName = '电影'; }
    }

    if (!view.querySelector('.container')) {
      view.innerHTML =
        '<div class="container page-wrap">' +
        '  <div class="page-head"><div class="page-title">' + esc(catName) + '</div></div>' +
        '  <div class="grid tv-direct-grid" id="tvDirectGrid"></div>' +
        '</div>';
    }
    ensureAuroraHero();

    ensureTvSources().then(function (sources) {
      if (!sources || !sources.length) {
        fallbackLoading = false;
        return;
      }
      var picked = sources.slice(0, 6);
      var seen = {};
      var items = [];
      var catRe = null;
      if (catName === '电影') catRe = /(电影|片)$|电影/;
      else if (catName === '剧集') catRe = /(剧|连续剧)/;
      else if (catName === '综艺') catRe = /(综艺|真人秀|晚会)/;
      else if (catName === '动漫') catRe = /(动漫|动画|漫画)/;

      var tasks = picked.map(function (s) {
        return window.API.list(s, 1).then(function (r) {
          var list = (r && r.list) || [];
          for (var i = 0; i < list.length; i++) {
            var vod = list[i];
            var t = String(vod.vod_name || '').trim();
            if (!t || seen[t]) continue;
            var tn = String(vod.type_name || '');
            if (catRe && !catRe.test(tn)) continue;
            seen[t] = 1;
            items.push({
              sourceKey: s.key,
              sourceName: s.name,
              id: vod.vod_id,
              title: t,
              pic: vod.vod_pic,
              remarks: vod.vod_remarks,
              year: vod.vod_year,
              typeName: tn
            });
          }
          if (view.querySelectorAll('.card').length === 0 && items.length > 0) {
            var targetGrid = document.getElementById('browseGrid') || document.getElementById('tvDirectGrid') || view.querySelector('.grid');
            if (!targetGrid) {
              view.innerHTML =
                '<div class="container page-wrap">' +
                '  <div class="page-head"><div class="page-title">' + esc(catName) + '</div></div>' +
                '  <div class="grid tv-direct-grid" id="tvDirectGrid"></div>' +
                '</div>';
              ensureAuroraHero();
              targetGrid = document.getElementById('tvDirectGrid');
            }
            if (targetGrid) {
              targetGrid.innerHTML = items.slice(0, 24).map(buildTvCardHtml).join('');
              var c0 = targetGrid.querySelector('.card');
              if (c0) updateAuroraHeroFromCard(c0);
            }
          }
        }).catch(function () {});
      });

      Promise.allSettled(tasks).then(function () {
        fallbackLoading = false;
      });
    });
  }

  function parsePlayHref(href) {
    var m = String(href || '').match(/^#\/play\/([^/?#]+)\/([^/?#]+)/);
    if (!m) return null;
    try {
      return { sourceKey: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) };
    } catch (e) {
      return { sourceKey: m[1], id: m[2] };
    }
  }

  function updateAuroraHeroFromCard(card) {
    if (!card) return;
    var hero = document.getElementById('tvAuroraHero') || ensureAuroraHero();
    if (!hero) return;

    var img = card.querySelector('img');
    var nameEl = card.querySelector('.card-name');
    var badgeEl = card.querySelector('.card-badge');
    var subEl = card.querySelector('.card-sub');
    var srcEl = card.querySelector('.card-src');

    var title = nameEl ? nameEl.textContent.trim() : '';
    var pic = img ? (img.getAttribute('src') || '') : '';
    var badge = badgeEl ? badgeEl.textContent.trim() : '';
    var sub = subEl ? subEl.textContent.trim() : '';
    var srcName = srcEl ? srcEl.textContent.trim() : '';
    var href = card.getAttribute('href') || '#/home';

    if (!title) return;
    currentHeroHref = href;

    var bgBlur = document.getElementById('tahBgBlur');
    var bgMain = document.getElementById('tahBgMain');
    var titleEl = document.getElementById('tahTitle');
    var tagsEl = document.getElementById('tahTags');
    var descEl = document.getElementById('tahDesc');
    var playBtn = document.getElementById('tahPlayBtn');

    if (titleEl) titleEl.textContent = title;
    if (playBtn) playBtn.setAttribute('href', href);
    if (pic) {
      var safePic = pic.replace(/"/g, '\\"');
      if (bgBlur) bgBlur.style.backgroundImage = 'url("' + safePic + '")';
      if (bgMain) bgMain.style.backgroundImage = 'url("' + safePic + '")';
    }

    var tagsHtml = '<span class="tah-tag tah-4k">4K HDR</span>';
    if (sub) {
      sub.split('·').forEach(function (part) {
        var t = part.trim();
        if (t) tagsHtml += '<span class="tah-tag">' + esc(t) + '</span>';
      });
    }
    if (badge && sub.indexOf(badge) === -1) {
      tagsHtml += '<span class="tah-tag">' + esc(badge) + '</span>';
    }
    if (srcName) {
      tagsHtml += '<span class="tah-tag">' + esc(srcName) + '</span>';
    }
    if (tagsEl) tagsEl.innerHTML = tagsHtml;

    var parsed = parsePlayHref(href);
    if (!parsed) return;
    var cacheKey = parsed.sourceKey + ':' + parsed.id;
    if (heroDetailCache.has(cacheKey)) {
      var cachedDesc = heroDetailCache.get(cacheKey);
      if (descEl && cachedDesc) descEl.textContent = cachedDesc;
      return;
    }

    if (descEl) {
      descEl.textContent = '《' + title + '》 · 按遥控器 OK 键立即进入播放，支持选集、简介预览与多线路秒换源。';
    }

    clearTimeout(heroFetchTimer);
    heroFetchTimer = setTimeout(function () {
      var hooks = getHooks();
      if (!hooks.findSourceByKey || !window.API || !window.API.detail) return;
      var srcObj = hooks.findSourceByKey(parsed.sourceKey);
      if (!srcObj) return;
      window.API.detail(srcObj, parsed.id, 8000).then(function (r) {
        var vod = r && r.list && r.list[0];
        if (!vod) return;
        var actor = stripTags(vod.vod_actor || '').replace(/&nbsp;/gi, ' ');
        var content = stripTags(vod.vod_content || '').replace(/&nbsp;/gi, ' ');
        var summary = '';
        if (actor) summary += '主演：' + actor.slice(0, 38) + (actor.length > 38 ? '… ' : ' · ');
        if (content) summary += content.slice(0, 110);
        if (summary) {
          heroDetailCache.set(cacheKey, summary);
          if (currentHeroHref === href && descEl) {
            descEl.textContent = summary;
          }
        }
      }).catch(function () {});
    }, 180);
  }

  /* ---------------- 7. TV 搜索页 (#/search): 左侧固定紧凑 A-Z 全键盘 + 手机扫码二维码 + 右侧 4 列独立滚动 ---------------- */
  var searchState = {
    buf: '',
    searchSeq: 0,
    debounceTimer: null,
    sid: ''
  };

  function getOrCreateSyncSid() {
    if (searchState.sid) return searchState.sid;
    try {
      var saved = sessionStorage.getItem('ntv_tv_sync_sid');
      if (saved) { searchState.sid = saved; return saved; }
    } catch (e) {}
    var rnd = 'tv' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
    searchState.sid = rnd;
    try { sessionStorage.setItem('ntv_tv_sync_sid', rnd); } catch (e) {}
    return rnd;
  }

  var BUILTIN_HOT_TITLES = [
    '九门', '老九门', '老九门之青山海棠', '盗墓笔记之九门', '盗墓笔记', '沙海', '终极笔记', '藏海花',
    '鬼吹灯', '龙岭迷窟', '怒晴湘西', '云南虫谷', '昆仑神宫', '南海归墟', '寻龙诀',
    '庆余年 第二季', '庆余年', '流浪地球2', '流浪地球', '狂飙', '三体', '漫长的季节',
    '封神第一部', '繁花', '热辣滚烫', '飞驰人生2', '第二十条', '周处除三害', '唐朝诡事录',
    '唐朝诡事录之西行', '凡人修仙传', '完美世界', '斗破苍穹', '仙逆', '吞噬星空', '遮天',
    '剑来', '诛仙', '斗罗大陆', '画江湖之不良人', '沧元图', '神印王座', '一念永恒',
    '白夜破晓', '白夜追凶', '边水往事', '雪迷宫', '我是刑警', '小巷人家', '永夜星河',
    '珠帘玉幕', '大梦归离', '九重紫', '猎罪图鉴2', '猎罪图鉴', '大奉打更人', '国色芳华',
    '白月梵星', '长相思', '与凤行', '玫瑰的故事', '墨雨云间', '狐妖小红娘', '时光代理人',
    '抓娃娃', '默杀', '孤注一掷', '消失的她', '满江红', '长津湖', '战狼2', '哪吒之魔童闹海',
    '哪吒之魔童降世', '长安三万里', '夏洛特烦恼', '西虹市首富', '独行月球', '好东西', '破地狱'
  ];

  function scorePyMatch(title, py, queryUpper) {
    if (!queryUpper) return 10;
    if (py === queryUpper) return 100;
    if (py.indexOf(queryUpper) === 0) return 85 - Math.min(10, py.length - queryUpper.length);
    if (py.indexOf(queryUpper) > 0) return 72 - Math.min(10, py.indexOf(queryUpper));
    if (title.toUpperCase().indexOf(queryUpper) >= 0) return 65;
    return 0;
  }

  function collectTitleCandidates(queryStr, extraCloudWords) {
    var hooks = getHooks();
    var q = String(queryStr || '').trim().toUpperCase();
    var seen = {};
    var scored = [];

    function consider(title, pic, remarks, sourceKey, id, bonus) {
      title = String(title || '').trim();
      if (!title || seen[title]) return;
      var py = getTitleInitials(title);
      var sc = q ? scorePyMatch(title, py, q) : (50 + (bonus || 0));
      if (q && sc <= 0 && !bonus) return;
      seen[title] = 1;
      scored.push({
        title: title,
        py: py,
        pic: pic || '',
        remarks: remarks || '',
        sourceKey: sourceKey || '',
        id: id || '',
        score: sc + (bonus || 0)
      });
    }

    if (Array.isArray(extraCloudWords)) {
      for (var c = 0; c < extraCloudWords.length; c++) {
        var cw = extraCloudWords[c];
        var cwTitle = (cw && typeof cw === 'object') ? cw.title : cw;
        if (cwTitle) consider(cwTitle, '', '智能联想', '', '', 25);
      }
    }

    for (var b = 0; b < BUILTIN_HOT_TITLES.length; b++) {
      consider(BUILTIN_HOT_TITLES[b], '', '热播', '', '', 5);
    }

    if (!q && hooks.store) {
      var hist = hooks.store.get('searchHist', []) || [];
      for (var h = 0; h < hist.length; h++) {
        consider(hist[h], '', '历史', '', '', 20);
      }
    }

    if (hooks.idx && typeof hooks.idx.forEach === 'function') {
      hooks.idx.forEach(function (it) {
        consider(it.title, it.pic, it.remarks, it.sourceKey, it.id, 10);
      });
    }

    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 10);
  }

  /* 【问题 3.1 修复】：删除九宫格与数字键，左栏严格一屏固定 A~Z 26个字母 + 退格/清空 + 手机扫码二维码 */
  function mountTvSearch(initialQuery) {
    var view = document.getElementById('view');
    if (!view) return;

    if (initialQuery && typeof initialQuery === 'string' && initialQuery.trim()) {
      searchState.buf = initialQuery.trim().toUpperCase();
    }

    var sid = getOrCreateSyncSid();
    var remoteUrl = location.origin + '/?tv_sid=' + encodeURIComponent(sid) + '#/tv-remote';
    var qrSvg = makeQrSvg(remoteUrl, 70);

    if (view.dataset.tvSearch === '1' && document.getElementById('tvsAuroraWrap')) {
      renderSearchInputAndMid();
      triggerLiveSearch(searchState.buf, true);
      startTvSyncPolling();
      return;
    }

    view.dataset.tvSearch = '1';
    // 仅保留 26 个英文字母 A~Z (6列×5行：第5行为 Y, Z, ⌫退格[2格], 🗑清空[2格])
    var alphaChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    view.innerHTML =
      '<div class="container page-wrap" style="padding-top:4px;padding-bottom:8px">' +
      '  <div class="tvs-aurora-wrap" id="tvsAuroraWrap">' +
      '    <!-- 左栏: 固定一屏 A-Z 全键盘 + 底部固定手机扫码二维码 (绝不上下滚动) -->' +
      '    <div class="tvs-left-panel">' +
      '      <div class="tvs-input-box">' +
      '        <span class="tvs-input-ico">🔍</span>' +
      '        <div class="tvs-input-text is-placeholder" id="tvsInputDisplay">输入首字母(如JM搜九门)</div>' +
      '      </div>' +
      '      <div class="tvs-kb-full" id="tvsKbFull">' +
               alphaChars.map(function (ch) {
                 return '<button type="button" class="tvs-char-btn" data-char="' + ch + '">' + ch + '</button>';
               }).join('') +
      '        <button type="button" class="tvs-fn-inline" data-fn="DEL">⌫ 退格</button>' +
      '        <button type="button" class="tvs-fn-inline" data-fn="CLR">🗑 清空</button>' +
      '      </div>' +
      '      <div class="tvs-qr-card" id="tvsQrCard">' +
      '        <div class="tvs-qr-box">' + qrSvg + '</div>' +
      '        <div class="tvs-qr-info">' +
      '          <div class="tvs-qr-title">📱 手机扫码同步搜</div>' +
      '          <div class="tvs-qr-desc">微信或相机扫码，在手机上打字直接推送到电视搜索</div>' +
      '          <div class="tvs-qr-status" id="tvsQrStatus">🟢 等待手机扫码输入…</div>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '    <!-- 中栏: 猜你想搜(首字母模糊联想) -->' +
      '    <div class="tvs-mid-panel">' +
      '      <div class="tvs-col-title" id="tvsMidTitle">💡 拼音首字母联想</div>' +
      '      <div class="tvs-col-sub" id="tvsMidSub">支持首字母模糊匹配（如 JM 搜九门）</div>' +
      '      <div class="tvs-sug-list" id="tvsSugList"></div>' +
      '    </div>' +
      '    <!-- 右栏: 独立上下滚动 4 列等高海报结果 -->' +
      '    <div class="tvs-right-panel">' +
      '      <div class="tvs-right-head">' +
      '        <div class="tvs-col-title" id="tvsRightTitle">🔥 热门大片推荐</div>' +
      '        <div class="tvs-right-stat" id="tvsRightStat">左侧输入首字母或用手机扫码直接投送搜索</div>' +
      '      </div>' +
      '      <div id="tvsResultGrid"></div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    bindTvSearchEvents();
    renderSearchInputAndMid();
    triggerLiveSearch(searchState.buf, true);
    startTvSyncPolling();

    setTimeout(function () {
      var firstKey = document.querySelector('#tvsKbFull button[data-char="A"]');
      if (firstKey) setFocus(firstKey, true);
    }, 60);
  }

  function startTvSyncPolling() {
    clearInterval(tvPollTimer);
    var sid = getOrCreateSyncSid();
    tvPollTimer = setInterval(function () {
      var view = document.getElementById('view');
      if (!view || view.dataset.tvSearch !== '1') {
        clearInterval(tvPollTimer);
        return;
      }
      if (!window.API || !window.API.tvSyncPoll) return;
      window.API.tvSyncPoll(sid).then(function (res) {
        if (!res || !res.q || !res.ts) return;
        if (res.ts > lastSyncedTs) {
          lastSyncedTs = res.ts;
          var remoteWord = String(res.q).trim();
          if (!remoteWord) return;
          searchState.buf = remoteWord;
          var qrStat = document.getElementById('tvsQrStatus');
          if (qrStat) qrStat.textContent = '✅ 已同步手机输入：「' + remoteWord + '」';
          var hooks = getHooks();
          if (hooks && hooks.toast) hooks.toast('📱 收到手机搜索：「' + remoteWord + '」', 'ok');
          renderSearchInputAndMid();
          triggerLiveSearch(remoteWord, true);
        }
      }).catch(function () {});
    }, 1500);
  }

  function appendSearchChar(ch) {
    searchState.buf = (searchState.buf + ch).slice(0, 18);
    renderSearchInputAndMid();
    scheduleLiveSearch();
  }

  function bindTvSearchEvents() {
    var wrap = document.getElementById('tvsAuroraWrap');
    if (!wrap) return;

    wrap.addEventListener('click', function (e) {
      var charBtn = e.target.closest('.tvs-char-btn');
      if (charBtn) {
        appendSearchChar(charBtn.getAttribute('data-char'));
        setFocus(charBtn, true);
        return;
      }

      var fnBtn = e.target.closest('button[data-fn]');
      if (fnBtn) {
        var fn = fnBtn.getAttribute('data-fn');
        if (fn === 'DEL') {
          searchState.buf = searchState.buf.slice(0, -1);
          renderSearchInputAndMid();
          scheduleLiveSearch();
        } else if (fn === 'CLR') {
          searchState.buf = '';
          renderSearchInputAndMid();
          triggerLiveSearch('', true);
        }
        setFocus(fnBtn, true);
        return;
      }

      var sugBtn = e.target.closest('.tvs-sug-btn');
      if (sugBtn) {
        var word = sugBtn.getAttribute('data-word') || '';
        if (word) {
          var disp = document.getElementById('tvsInputDisplay');
          if (disp) {
            disp.textContent = word;
            disp.classList.remove('is-placeholder');
          }
          triggerLiveSearch(word, true);
          setFocus(sugBtn, true);
        }
      }
    });
  }

  function renderSearchInputAndMid(extraCloudWords) {
    var disp = document.getElementById('tvsInputDisplay');
    var midTitle = document.getElementById('tvsMidTitle');
    var midSub = document.getElementById('tvsMidSub');
    var sugList = document.getElementById('tvsSugList');
    if (!disp || !sugList) return [];

    if (searchState.buf) {
      disp.textContent = /^[A-Z0-9]+$/.test(searchState.buf) ? searchState.buf.split('').join(' ') : searchState.buf;
      disp.classList.remove('is-placeholder');
      if (midTitle) midTitle.textContent = '💡 拼音首字母联想';
      if (midSub) midSub.textContent = '首字母「' + searchState.buf + '」模糊匹配';
    } else {
      disp.textContent = '输入首字母(如JM搜九门)';
      disp.classList.add('is-placeholder');
      if (midTitle) midTitle.textContent = '💡 拼音首字母联想';
      if (midSub) midSub.textContent = '大家都在搜 · 支持首字母模糊匹配';
    }

    var cands = collectTitleCandidates(searchState.buf, extraCloudWords);
    if (!cands.length && searchState.buf) {
      cands = [{ title: searchState.buf, py: '全网直接搜索该关键词', remarks: '直搜' }];
    }

    sugList.innerHTML = cands.slice(0, 8).map(function (c, idx) {
      var rankCls = idx === 0 ? 'r1' : idx === 1 ? 'r2' : idx === 2 ? 'r3' : '';
      return '<button type="button" class="tvs-sug-btn" data-word="' + esc(c.title) + '">' +
        '<span class="tvs-sug-rank ' + rankCls + '">' + (idx + 1) + '</span>' +
        '<div class="tvs-sug-info">' +
        '  <div class="tvs-sug-name">' + esc(c.title) + '</div>' +
        (c.py ? '  <div class="tvs-sug-py">' + esc(c.py) + '</div>' : '') +
        '</div>' +
        '</button>';
    }).join('');

    return cands;
  }

  function scheduleLiveSearch() {
    clearTimeout(searchState.debounceTimer);
    renderLocalPosterPreview(searchState.buf);
    searchState.debounceTimer = setTimeout(function () {
      triggerLiveSearch(searchState.buf, false);
    }, 280);
  }

  function renderLocalPosterPreview(rawQ) {
    var grid = document.getElementById('tvsResultGrid');
    var stat = document.getElementById('tvsRightStat');
    var rightTitle = document.getElementById('tvsRightTitle');
    var hooks = getHooks();
    if (!grid) return;

    var q = String(rawQ || '').trim().toUpperCase();
    var localItems = [];
    if (hooks.idx && typeof hooks.idx.forEach === 'function') {
      hooks.idx.forEach(function (it) {
        if (!it.pic) return;
        if (!q) {
          if (localItems.length < 12) localItems.push(it);
          return;
        }
        var py = getTitleInitials(it.title);
        if (scorePyMatch(it.title, py, q) > 0) {
          localItems.push(it);
        }
      });
    }

    if (!q) {
      if (rightTitle) rightTitle.textContent = '🔥 热门大片推荐';
      if (stat) stat.textContent = '在左侧输入片名首字母（如 JM 搜九门）或用手机扫码直接输入';
      if (localItems.length) {
        grid.innerHTML = localItems.slice(0, 12).map(buildTvCardHtml).join('');
      } else {
        ensureTvSources().then(function (sources) {
          if (!sources.length || searchState.buf) return;
          window.API.list(sources[0], 1).then(function (r) {
            var g2 = document.getElementById('tvsResultGrid');
            if (!g2 || searchState.buf) return;
            var list = (r && r.list) || [];
            g2.innerHTML = list.slice(0, 12).map(function (vod) {
              return buildTvCardHtml({
                sourceKey: sources[0].key,
                sourceName: sources[0].name,
                id: vod.vod_id,
                title: vod.vod_name,
                pic: vod.vod_pic,
                remarks: vod.vod_remarks,
                year: vod.vod_year,
                typeName: vod.type_name
              });
            }).join('');
          }).catch(function () {});
        });
      }
      return;
    }

    if (localItems.length) {
      if (rightTitle) rightTitle.textContent = '🔥 搜索结果';
      if (stat) stat.textContent = '已秒配 ' + localItems.length + ' 部本地片源 · 正在并发检索全网影视源…';
      grid.innerHTML = localItems.slice(0, 16).map(buildTvCardHtml).join('');
    }
  }

  function triggerLiveSearch(rawQuery, immediate) {
    var grid = document.getElementById('tvsResultGrid');
    var stat = document.getElementById('tvsRightStat');
    var rightTitle = document.getElementById('tvsRightTitle');
    var hooks = getHooks();
    if (!grid || !window.API) return;

    var q = String(rawQuery || '').trim();
    if (!q) {
      renderLocalPosterPreview('');
      return;
    }

    var seq = ++searchState.searchSeq;
    var isPureAlpha = /^[a-zA-Z]{1,12}$/.test(q);
    var suggestPromise = (isPureAlpha && window.API.pySuggest)
      ? window.API.pySuggest(q)
      : Promise.resolve({ list: [] });

    Promise.all([ensureTvSources(), suggestPromise]).then(function (pair) {
      if (seq !== searchState.searchSeq) return;
      var sources = pair[0] || [];
      var pyRes = pair[1] || { list: [] };
      if (!sources.length) return;

      var cloudWords = (pyRes.list || pyRes.words || []).map(function (x) {
        return (x && typeof x === 'object') ? x.title : x;
      }).filter(Boolean);
      var cands = renderSearchInputAndMid(cloudWords);

      var searchKeywords = [];
      if (isPureAlpha) {
        for (var ci = 0; ci < cands.length && searchKeywords.length < 2; ci++) {
          var w = cands[ci].title;
          if (w && !/^[a-zA-Z0-9]+$/.test(w) && searchKeywords.indexOf(w) === -1) {
            searchKeywords.push(w);
          }
        }
      }
      if (!searchKeywords.length) {
        searchKeywords.push(q);
      }

      var primaryKw = searchKeywords[0];
      if (immediate) {
        if (hooks.pushSearchHist) hooks.pushSearchHist(primaryKw);
        if (hooks.logSearch) hooks.logSearch(primaryKw);
      }

      if (rightTitle) {
        rightTitle.textContent = '🔥 搜索结果 · ' + searchKeywords.join(' / ');
      }
      if (stat) {
        stat.textContent = '⏳ 正在并发检索 ' + sources.length + ' 个影视源…';
      }

      var merged = new Map();

      if (isPureAlpha && hooks.idx) {
        var up = q.toUpperCase();
        hooks.idx.forEach(function (it) {
          var py = getTitleInitials(it.title);
          if (scorePyMatch(it.title, py, up) > 0 && it.pic) {
            var k0 = it.title + '|' + (it.year || '');
            if (!merged.has(k0)) {
              merged.set(k0, Object.assign({}, it, { srcCount: 1, showSource: true }));
            }
          }
        });
      }

      var tasks = [];
      for (var si = 0; si < sources.length; si++) {
        for (var ki = 0; ki < searchKeywords.length; ki++) {
          tasks.push({ s: sources[si], kw: searchKeywords[ki] });
        }
      }

      var done = 0;
      var tIdx = 0;
      var CONC = Math.min(10, tasks.length);

      function renderMerged() {
        if (seq !== searchState.searchSeq) return;
        var curGrid = document.getElementById('tvsResultGrid');
        var curStat = document.getElementById('tvsRightStat');
        if (!curGrid) return;
        var arr = Array.from(merged.values()).sort(function (a, b) {
          return (b.srcCount || 1) - (a.srcCount || 1);
        });
        if (curStat) {
          curStat.textContent = (done >= tasks.length ? '✅ 搜索完成 · ' : '⏳ 检索中 (' + Math.min(sources.length, Math.ceil(done / searchKeywords.length)) + '/' + sources.length + ') · ') +
            '共找到 ' + arr.length + ' 部影片';
        }
        if (arr.length) {
          curGrid.innerHTML = arr.slice(0, 36).map(buildTvCardHtml).join('');
        } else if (done >= tasks.length) {
          curGrid.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:48px 0"><div class="big">🙈</div><p>未找到「' + esc(searchKeywords.join(' / ')) + '」相关影片，可尝试用手机扫描左下角二维码直接输入片名</p></div>';
        }
      }

      function worker() {
        if (tIdx >= tasks.length || seq !== searchState.searchSeq) return Promise.resolve();
        var job = tasks[tIdx++];
        return window.API.search(job.s, job.kw, 1, 12000).then(function (r) {
          if (seq !== searchState.searchSeq) return;
          var list = (r && r.list) || [];
          for (var i = 0; i < list.length; i++) {
            var vod = list[i];
            var title = String(vod.vod_name || '').trim();
            if (!title) continue;
            var k = title.replace(/[\s·:：,，.!！?？]/g, '').toLowerCase() + '|' + (vod.vod_year || '');
            var hit = {
              sourceKey: job.s.key,
              sourceName: job.s.name,
              adult: job.s.adult,
              id: vod.vod_id,
              title: title,
              pic: vod.vod_pic,
              remarks: vod.vod_remarks,
              year: vod.vod_year,
              typeName: vod.type_name,
              srcCount: 1,
              showSource: true
            };
            if (merged.has(k)) {
              merged.get(k).srcCount++;
            } else {
              merged.set(k, hit);
            }
          }
        }).catch(function () {}).then(function () {
          done++;
          renderMerged();
          return worker();
        });
      }

      var workers = [];
      for (var w = 0; w < CONC; w++) workers.push(worker());
      Promise.allSettled(workers).then(renderMerged);
    });
  }

  window.XLTV_MOUNT_SEARCH = function (q) {
    mountTvSearch(q);
    return Promise.resolve();
  };

  /* ---------------- 8. TV 端专属播放页工作台 (#tvPlayCockpit) + 全屏模式切换 ---------------- */
  var tvPlayEpRangeIdx = 0;
  var TV_EP_PAGE_SIZE = 30;

  function isPlayRoute() {
    return (location.hash || '').indexOf('#/play/') === 0;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function enterTvFullscreen() {
    document.body.classList.add('tv-fs-mode');
    scheduleHideHint(4500);
  }

  function exitTvFullscreen() {
    closePlayerOsd();
    document.body.classList.remove('tv-fs-mode');
    var fsBtn = document.getElementById('tvBtnFs');
    if (fsBtn && visible(fsBtn)) setFocus(fsBtn, true);
  }

  function syncTvPlayerMode() {
    var playing = isPlayRoute();
    document.body.classList.toggle('tv-playing', playing);
    if (!playing) {
      document.body.classList.remove('tv-fs-mode');
      return;
    }

    var wrap = document.getElementById('videoWrap');
    var video = document.getElementById('videoEl');
    var topRow = document.querySelector('.play-top-row');
    var playCol = document.querySelector('.play-col');
    if (!wrap || !video || !topRow || !playCol) return;

    video.removeAttribute('controls');

    // 1. 挂载左下方遥控器大按钮控制栏 (#tvPlayCtrlBar)
    var ctrlBar = document.getElementById('tvPlayCtrlBar');
    if (!ctrlBar) {
      ctrlBar = document.createElement('div');
      ctrlBar.id = 'tvPlayCtrlBar';
      ctrlBar.innerHTML =
        '<button type="button" class="tv-pctrl-btn primary" id="tvBtnFs">🖥 全屏播放 (按OK键)</button>' +
        '<button type="button" class="tv-pctrl-btn" id="tvBtnPp">⏯ 播放/暂停</button>' +
        '<button type="button" class="tv-pctrl-btn" id="tvBtnNext">⏭ 下一集</button>' +
        '<button type="button" class="tv-pctrl-btn" id="tvBtnFav">☆ 收藏影片</button>';
      playCol.appendChild(ctrlBar);

      document.getElementById('tvBtnFs').addEventListener('click', function () {
        enterTvFullscreen();
      });
      document.getElementById('tvBtnPp').addEventListener('click', function () {
        if (video.paused) video.play().catch(function () {});
        else video.pause();
      });
      document.getElementById('tvBtnNext').addEventListener('click', function () {
        var curEp = document.querySelector('#sideEps .ep-btn.current');
        if (curEp && curEp.nextElementSibling && curEp.nextElementSibling.classList.contains('ep-btn')) {
          curEp.nextElementSibling.click();
        } else {
          var hooks = getHooks();
          if (hooks && hooks.toast) hooks.toast('已经是当前页最后一集了');
        }
      });
      document.getElementById('tvBtnFav').addEventListener('click', function () {
        var origFav = document.getElementById('playFav');
        if (origFav) origFav.click();
        refreshTvPlayCockpit();
      });
    }

    // 2. 挂载右侧 TV 专属选集/换源/简介控制台 (#tvPlayRightPanel)
    var rightPanel = document.getElementById('tvPlayRightPanel');
    if (!rightPanel) {
      rightPanel = document.createElement('div');
      rightPanel.id = 'tvPlayRightPanel';
      rightPanel.innerHTML =
        '<div class="tvp-meta-head">' +
        '  <div class="tvp-vod-title" id="tvpVodTitle">正在加载影片…</div>' +
        '  <div class="tvp-vod-badges" id="tvpVodBadges"></div>' +
        '  <div class="tvp-vod-desc" id="tvpVodDesc"></div>' +
        '</div>' +
        '<div>' +
        '  <div class="tvp-sec-label"><span>⇄ 切换片源</span><small id="tvpSrcCount" style="color:var(--tv-dim);font-weight:600"></small></div>' +
        '  <div class="tvp-src-list" id="tvPlaySrcList"></div>' +
        '</div>' +
        '<div style="flex:1;display:flex;flex-direction:column;min-height:0">' +
        '  <div class="tvp-sec-label"><span id="tvpEpTitle">📺 选集列表</span><small style="color:var(--tv-dim);font-weight:600">方向键选择 · OK 播放</small></div>' +
        '  <div class="tvp-ep-ranges" id="tvPlayEpRanges"></div>' +
        '  <div class="tvp-ep-grid" id="tvPlayEpGrid"></div>' +
        '</div>';
      topRow.appendChild(rightPanel);
    }

    // 3. 挂载下方 4 列相关推荐区域 (#tvPlayRelWrap)
    var relWrap = document.getElementById('tvPlayRelWrap');
    if (!relWrap) {
      relWrap = document.createElement('div');
      relWrap.id = 'tvPlayRelWrap';
      relWrap.innerHTML =
        '<div class="row-head"><div class="row-title">🎬 相关影片推荐</div></div>' +
        '<div class="grid" id="tvPlayRelGrid"></div>';
      topRow.parentElement.appendChild(relWrap);
    }

    // 4. 全屏态内部提示与底部呼出浮层 (#tvPlayHint / #tvPlayCenterHud / #tvPlayerOsd)
    if (!document.getElementById('tvPlayHint')) {
      var hint = document.createElement('div');
      hint.id = 'tvPlayHint';
      hint.innerHTML =
        '<span><b>◀▶</b> 快进/快退</span>' +
        '<span><b>OK</b> 暂停/播放</span>' +
        '<span><b>▼</b> 选集/换源</span>' +
        '<span><b>返回键</b> 退出全屏</span>';
      wrap.appendChild(hint);
    }

    if (!document.getElementById('tvPlayCenterHud')) {
      var hud = document.createElement('div');
      hud.id = 'tvPlayCenterHud';
      wrap.appendChild(hud);
    }

    if (!document.getElementById('tvPlayerOsd')) {
      var osd = document.createElement('div');
      osd.id = 'tvPlayerOsd';
      osd.innerHTML =
        '<div class="tvo-head">' +
        '  <div class="tvo-title" id="tvoTitle">正在播放</div>' +
        '  <div class="tvo-sub" id="tvoSub">▲▼ 切换选集与线路 · OK 确认 · 返回键收起</div>' +
        '</div>' +
        '<div class="tvo-prog-row">' +
        '  <span class="tvo-time" id="tvoCurTime">00:00:00</span>' +
        '  <div class="tvo-bar-track"><div class="tvo-bar-fill" id="tvoBarFill"></div></div>' +
        '  <span class="tvo-time" id="tvoDurTime">/ 00:00:00</span>' +
        '</div>' +
        '<div class="tvo-rail" id="tvOsdEpRow"></div>' +
        '<div class="tvo-rail" id="tvOsdSrcRow"></div>';
      wrap.appendChild(osd);

      video.addEventListener('timeupdate', updateOsdProgress);
      video.addEventListener('loadedmetadata', updateOsdProgress);
      video.addEventListener('play', function () { scheduleHideHint(4200); });
    }

    refreshTvPlayCockpit();
    refreshOsdContent();
    scheduleHideHint(5000);

    // 首次进入播放页默认将焦点放在「🖥 全屏播放 (按OK键)」按钮上
    if (!document.querySelector('.' + FOCUSED_CLS)) {
      var fsBtn0 = document.getElementById('tvBtnFs');
      if (fsBtn0 && visible(fsBtn0)) setFocus(fsBtn0, true);
    }
  }

  function refreshTvPlayCockpit() {
    var metaEl = document.getElementById('vodMetaData');
    var pbTitle = document.querySelector('.pb-title');
    var curEpEl = document.getElementById('curEpName');
    var titleBox = document.getElementById('tvpVodTitle');
    var badgesBox = document.getElementById('tvpVodBadges');
    var descBox = document.getElementById('tvpVodDesc');

    var vTitle = metaEl ? (metaEl.getAttribute('data-title') || '') : (pbTitle && pbTitle.childNodes[0] ? pbTitle.childNodes[0].textContent.trim() : '');
    var epStr = curEpEl ? curEpEl.textContent.trim() : '';
    if (titleBox && vTitle) {
      titleBox.innerHTML = esc(vTitle) + (epStr ? ' <small style="font-size:16px;color:var(--tv-cyan)">· ' + esc(epStr) + '</small>' : '');
    }

    if (badgesBox && metaEl) {
      var yr = metaEl.getAttribute('data-year') || '';
      var area = metaEl.getAttribute('data-area') || '';
      var tp = metaEl.getAttribute('data-type') || '';
      var rem = metaEl.getAttribute('data-remarks') || '';
      var bHtml = '<span class="tvp-badge">高清极速</span>';
      if (yr) bHtml += '<span class="tvp-badge">' + esc(yr) + '</span>';
      if (area) bHtml += '<span class="tvp-badge">' + esc(area) + '</span>';
      if (tp) bHtml += '<span class="tvp-badge">' + esc(tp) + '</span>';
      if (rem) bHtml += '<span class="tvp-badge">' + esc(rem) + '</span>';
      badgesBox.innerHTML = bHtml;
    }

    if (descBox && metaEl) {
      var actor = metaEl.getAttribute('data-actor') || '';
      var desc = metaEl.getAttribute('data-desc') || '';
      var text = '';
      if (actor) text += '主演：' + actor.slice(0, 36) + ' · ';
      if (desc) text += desc;
      descBox.textContent = text || '使用遥控器方向键可快速切换备用播放源或剧集，点击全屏按钮即可全屏观影。';
    }

    // 同步收藏按钮状态
    var origFav = document.getElementById('playFav');
    var tvFav = document.getElementById('tvBtnFav');
    if (origFav && tvFav) {
      var isFav = origFav.classList.contains('on');
      tvFav.textContent = isFav ? '★ 已收藏' : '☆ 收藏影片';
    }

    // 同步片源列表 (#tvPlaySrcList)
    var srcListEl = document.getElementById('tvPlaySrcList');
    var srcCountEl = document.getElementById('tvpSrcCount');
    if (srcListEl) {
      var curBadge = document.querySelector('#srcBadge span');
      var curSrcName = curBadge ? curBadge.textContent.trim() : '当前源';
      var srcItems = document.querySelectorAll('#srcSwitch a.src-item');
      if (srcCountEl) srcCountEl.textContent = '共 ' + (srcItems.length + 1) + ' 个可用源';

      var sHtml = '<button type="button" class="tvp-src-btn current" data-cur="1">🟢 ' + esc(curSrcName) + ' (当前)</button>';
      for (var s = 0; s < Math.min(12, srcItems.length); s++) {
        var a = srcItems[s];
        var sNameEl = a.querySelector('span');
        var spdEl = a.querySelector('i.spd');
        var sName = sNameEl ? sNameEl.textContent.trim() : ('备用源' + (s + 2));
        var spd = spdEl ? spdEl.textContent.trim() : '';
        sHtml += '<button type="button" class="tvp-src-btn" data-href="' + esc(a.getAttribute('href') || '') + '">' +
          esc(sName) + (spd ? ' · ' + esc(spd) : '') + '</button>';
      }
      srcListEl.innerHTML = sHtml;
      srcListEl.onclick = function (e) {
        var btn = e.target.closest('button.tvp-src-btn');
        if (!btn || btn.hasAttribute('data-cur')) return;
        var targetHref = btn.getAttribute('data-href');
        if (targetHref) location.replace(targetHref);
      };
    }

    // 同步 5 列选集矩阵 (#tvPlayEpGrid)
    var epGrid = document.getElementById('tvPlayEpGrid');
    var epRanges = document.getElementById('tvPlayEpRanges');
    var epTitle = document.getElementById('tvpEpTitle');
    var origEps = document.querySelectorAll('#sideEps .ep-btn');
    if (epGrid && origEps.length) {
      if (epTitle) epTitle.textContent = '📺 选集列表 (1-' + origEps.length + ')';
      var totalEps = origEps.length;
      var pageCount = Math.ceil(totalEps / TV_EP_PAGE_SIZE);
      if (tvPlayEpRangeIdx >= pageCount) tvPlayEpRangeIdx = 0;

      if (epRanges) {
        if (pageCount <= 1) {
          epRanges.innerHTML = '';
        } else {
          var rHtml = '';
          for (var p = 0; p < pageCount; p++) {
            var st = p * TV_EP_PAGE_SIZE + 1;
            var ed = Math.min(totalEps, (p + 1) * TV_EP_PAGE_SIZE);
            rHtml += '<button type="button" class="tvp-range-btn ' + (p === tvPlayEpRangeIdx ? 'on' : '') + '" data-rp="' + p + '">' + st + '-' + ed + '</button>';
          }
          epRanges.innerHTML = rHtml;
          epRanges.onclick = function (e) {
            var rb = e.target.closest('button.tvp-range-btn');
            if (!rb) return;
            tvPlayEpRangeIdx = Number(rb.getAttribute('data-rp') || 0);
            refreshTvPlayCockpit();
            var newRb = epRanges.querySelector('button[data-rp="' + tvPlayEpRangeIdx + '"]');
            if (newRb) setFocus(newRb, true);
          };
        }
      }

      var startIdx = tvPlayEpRangeIdx * TV_EP_PAGE_SIZE;
      var endIdx = Math.min(totalEps, startIdx + TV_EP_PAGE_SIZE);
      var eHtml = '';
      for (var i = startIdx; i < endIdx; i++) {
        var b = origEps[i];
        var isCur = b.classList.contains('current');
        var lbl = b.textContent.trim();
        // 将纯数字集数格式化为 01, 02
        if (/^第?\d+[集期话]?$/.test(lbl)) {
          var numM = lbl.match(/\d+/);
          if (numM) lbl = String(numM[0]).padStart(2, '0');
        }
        eHtml += '<button type="button" class="tvp-ep-btn ' + (isCur ? 'current' : '') + '" data-eidx="' + i + '">' + esc(lbl) + '</button>';
      }
      epGrid.innerHTML = eHtml;
      epGrid.onclick = function (e) {
        var eb = e.target.closest('button.tvp-ep-btn');
        if (!eb) return;
        var idx = Number(eb.getAttribute('data-eidx'));
        var allOrig = document.querySelectorAll('#sideEps .ep-btn');
        if (allOrig[idx]) {
          allOrig[idx].click();
          setTimeout(refreshTvPlayCockpit, 80);
        }
      };
    }

    // 同步底部 4 列相关推荐 (#tvPlayRelGrid)
    var relGrid = document.getElementById('tvPlayRelGrid');
    var origRelCards = document.querySelectorAll('#relSec .card, #relRailList .rail-item');
    if (relGrid && origRelCards.length && relGrid.children.length === 0) {
      var secCards = document.querySelectorAll('#relSec .card');
      if (secCards.length) {
        var rCardsHtml = '';
        for (var rc = 0; rc < Math.min(8, secCards.length); rc++) {
          rCardsHtml += secCards[rc].outerHTML;
        }
        relGrid.innerHTML = rCardsHtml;
      }
    }
  }

  function scheduleHideHint(ms) {
    var hint = document.getElementById('tvPlayHint');
    if (!hint) return;
    hint.classList.remove('hide');
    clearTimeout(hintHideTimer);
    hintHideTimer = setTimeout(function () {
      var osd = document.getElementById('tvPlayerOsd');
      if (!osd || !osd.classList.contains('open')) {
        hint.classList.add('hide');
      }
    }, ms || 4500);
  }

  function showCenterHud(text, ms) {
    var hud = document.getElementById('tvPlayCenterHud');
    if (!hud) return;
    hud.textContent = text;
    hud.classList.add('show');
    clearTimeout(hudHideTimer);
    hudHideTimer = setTimeout(function () {
      hud.classList.remove('show');
    }, ms || 1200);
  }

  function updateOsdProgress() {
    var video = document.getElementById('videoEl');
    var curEl = document.getElementById('tvoCurTime');
    var durEl = document.getElementById('tvoDurTime');
    var fillEl = document.getElementById('tvoBarFill');
    if (!video || !curEl || !durEl || !fillEl) return;
    var c = video.currentTime || 0;
    var d = video.duration || 0;
    curEl.textContent = fmtTime(c);
    durEl.textContent = '/ ' + fmtTime(d);
    var pct = d > 0 ? Math.min(100, Math.max(0, (c / d) * 100)) : 0;
    fillEl.style.width = pct.toFixed(2) + '%';
  }

  function refreshOsdContent() {
    var pbTitle = document.querySelector('.pb-title');
    var curEpEl = document.getElementById('curEpName');
    var tvoTitle = document.getElementById('tvoTitle');
    if (tvoTitle && pbTitle) {
      var epStr = curEpEl ? curEpEl.textContent.trim() : '';
      var rawTitle = pbTitle.childNodes[0] ? pbTitle.childNodes[0].textContent.trim() : pbTitle.textContent.trim();
      tvoTitle.textContent = '《' + rawTitle + '》 ' + epStr;
    }

    var epRow = document.getElementById('tvOsdEpRow');
    var sideEps = document.querySelectorAll('#sideEps .ep-btn');
    if (epRow && sideEps.length) {
      var epHtml = '';
      for (var i = 0; i < Math.min(30, sideEps.length); i++) {
        var b = sideEps[i];
        var isCur = b.classList.contains('current');
        var label = b.textContent.trim();
        epHtml += '<button type="button" class="tvo-pill ' + (isCur ? 'current' : '') + '" data-epidx="' + i + '">' +
          '<span>' + esc(label) + '</span>' +
          (isCur ? '<small>[正在播放]</small>' : '') +
          '</button>';
      }
      epRow.innerHTML = epHtml;
      epRow.onclick = function (e) {
        var pill = e.target.closest('button.tvo-pill');
        if (!pill) return;
        var idx = Number(pill.getAttribute('data-epidx'));
        var origBtns = document.querySelectorAll('#sideEps .ep-btn');
        if (origBtns[idx]) {
          origBtns[idx].click();
          setTimeout(function () {
            refreshOsdContent();
            refreshTvPlayCockpit();
            closePlayerOsd();
          }, 120);
        }
      };
    }

    var srcRow = document.getElementById('tvOsdSrcRow');
    if (srcRow) {
      var curBadge = document.querySelector('#srcBadge span');
      var curSrcName = curBadge ? curBadge.textContent.trim() : '当前源';
      var srcItems = document.querySelectorAll('#srcSwitch a.src-item');

      var srcHtml = '<button type="button" class="tvo-pill current" data-act="cursrc">' +
        '<span>线路1: ' + esc(curSrcName) + '</span><small>[当前线路]</small></button>';

      for (var s = 0; s < Math.min(8, srcItems.length); s++) {
        var a = srcItems[s];
        var sNameEl = a.querySelector('span');
        var spdEl = a.querySelector('i.spd');
        var sName = sNameEl ? sNameEl.textContent.trim() : ('备用源' + (s + 2));
        var spd = spdEl ? spdEl.textContent.trim() : '可用';
        srcHtml += '<button type="button" class="tvo-pill" data-swap="' + s + '">' +
          '<span>线路' + (s + 2) + ': ' + esc(sName) + '</span><small>' + esc(spd) + '</small></button>';
      }

      srcHtml += '<button type="button" class="tvo-pill" data-act="exitfs"><span>🗗 退出全屏选集</span></button>';

      srcRow.innerHTML = srcHtml;
      srcRow.onclick = function (e) {
        var pill = e.target.closest('button.tvo-pill');
        if (!pill) return;
        if (pill.hasAttribute('data-swap')) {
          var sIdx = Number(pill.getAttribute('data-swap'));
          var links = document.querySelectorAll('#srcSwitch a.src-item');
          if (links[sIdx]) {
            closePlayerOsd();
            location.replace(links[sIdx].getAttribute('href'));
          }
          return;
        }
        var act = pill.getAttribute('data-act');
        if (act === 'exitfs') {
          exitTvFullscreen();
        } else if (act === 'cursrc') {
          closePlayerOsd();
        }
      };
    }
  }

  function openPlayerOsd() {
    var osd = document.getElementById('tvPlayerOsd');
    if (!osd) return;
    refreshOsdContent();
    updateOsdProgress();
    osd.classList.add('open');
    scheduleHideHint(8000);
    bumpOsdTimer();
    var curEpPill = osd.querySelector('#tvOsdEpRow .tvo-pill.current') || osd.querySelector('.tvo-pill');
    if (curEpPill) setFocus(curEpPill, false);
  }

  function closePlayerOsd() {
    var osd = document.getElementById('tvPlayerOsd');
    if (osd) osd.classList.remove('open');
    clearTimeout(osdHideTimer);
    scheduleHideHint(2500);
  }

  function bumpOsdTimer() {
    clearTimeout(osdHideTimer);
    osdHideTimer = setTimeout(function () {
      closePlayerOsd();
    }, 8500);
  }

  /* ---------------- 9. 全局 TV 遥控器软键盘弹窗 (#tvModalKbMask - 供登录/注册输入数字与字母) ---------------- */
  var modalKbState = {
    targetInput: null,
    upper: false
  };

  function ensureModalKb() {
    var mask = document.getElementById('tvModalKbMask');
    if (mask) return mask;
    mask = document.createElement('div');
    mask.id = 'tvModalKbMask';
    mask.className = 'hidden';
    document.body.appendChild(mask);
    return mask;
  }

  function openModalKb(inputEl) {
    if (!inputEl) return;
    modalKbState.targetInput = inputEl;
    inputEl.readOnly = true;
    var mask = ensureModalKb();
    renderModalKb();
    mask.classList.remove('hidden');
    var firstKey = mask.querySelector('.tmk-key');
    if (firstKey) setFocus(firstKey, true);
  }

  function closeModalKb(focusNext) {
    var mask = document.getElementById('tvModalKbMask');
    var target = modalKbState.targetInput;
    if (mask) mask.classList.add('hidden');
    modalKbState.targetInput = null;
    if (target && focusNext) {
      var formHost = target.closest('.login-box, .modal-box') || document;
      var subBtn = formHost.querySelector('#authBtn, .btn-submit, .t-go, button.primary');
      if (subBtn && visible(subBtn)) setFocus(subBtn, true);
      else setFocus(target, true);
    }
  }

  function renderModalKb() {
    var mask = ensureModalKb();
    var t = modalKbState.targetInput;
    var val = t ? (t.value || '') : '';
    var placeholder = t ? (t.getAttribute('placeholder') || '请输入内容') : '请输入';
    var letters = (modalKbState.upper ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : 'abcdefghijklmnopqrstuvwxyz').split('');
    var nums = '1234567890_@.-'.split('');
    var allKeys = letters.concat(nums);

    mask.innerHTML =
      '<div class="tmk-box">' +
      '  <div class="tmk-head">' +
      '    <div class="tmk-title">📺 遥控器输入 · ' + esc(placeholder) + '</div>' +
      '    <div style="font-size:14px;color:#8fa4c9">方向键选择 · OK 输入 · 返回键完成</div>' +
      '  </div>' +
      '  <div class="tmk-preview">' + (val ? esc(val) : '<span style="color:#657aa3;font-size:17px">' + esc(placeholder) + '</span>') + '</div>' +
      '  <div class="tmk-grid">' +
           allKeys.map(function (k) {
             return '<button type="button" class="tmk-key" data-k="' + esc(k) + '">' + esc(k) + '</button>';
           }).join('') +
      '    <button type="button" class="tmk-key fn" data-fn="CASE" style="grid-column:span 2">' + (modalKbState.upper ? '⇩ 小写' : '⇧ 大写') + '</button>' +
      '    <button type="button" class="tmk-key fn" data-fn="DEL" style="grid-column:span 2">⌫ 退格</button>' +
      '    <button type="button" class="tmk-key fn" data-fn="CLR" style="grid-column:span 2">🗑 清空</button>' +
      '    <button type="button" class="tmk-key ok" data-fn="DONE" style="grid-column:span 3">✅ 确认完成</button>' +
      '  </div>' +
      '</div>';

    mask.onclick = function (e) {
      if (e.target === mask) {
        closeModalKb(true);
        return;
      }
      var btn = e.target.closest('button.tmk-key');
      if (!btn || !modalKbState.targetInput) return;
      var k = btn.getAttribute('data-k');
      var fn = btn.getAttribute('data-fn');
      var inp = modalKbState.targetInput;

      if (k !== null) {
        inp.value = (inp.value || '') + k;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        var prev = mask.querySelector('.tmk-preview');
        if (prev) prev.textContent = inp.value;
        setFocus(btn, true);
      } else if (fn === 'DEL') {
        inp.value = (inp.value || '').slice(0, -1);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        renderModalKb();
        var delBtn = mask.querySelector('button[data-fn="DEL"]');
        if (delBtn) setFocus(delBtn, true);
      } else if (fn === 'CLR') {
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        renderModalKb();
        var clrBtn = mask.querySelector('button[data-fn="CLR"]');
        if (clrBtn) setFocus(clrBtn, true);
      } else if (fn === 'CASE') {
        modalKbState.upper = !modalKbState.upper;
        renderModalKb();
        var caseBtn = mask.querySelector('button[data-fn="CASE"]');
        if (caseBtn) setFocus(caseBtn, true);
      } else if (fn === 'DONE') {
        closeModalKb(true);
      }
    };
  }

  document.addEventListener('click', function (e) {
    var inp = e.target.closest('input');
    if (!inp) return;
    var type = (inp.getAttribute('type') || 'text').toLowerCase();
    if (/^(text|password|search|tel|email|url)$/.test(type)) {
      e.preventDefault();
      e.stopPropagation();
      openModalKb(inp);
    }
  }, true);

  /* ---------------- 10. 电视直播页 (#/live) 与会员中心 (#/user) 遥控器适配 ---------------- */
  function enhanceLivePage() {
    if ((location.hash || '').indexOf('#/live') !== 0) {
      document.body.classList.remove('live-fs-mode');
      return;
    }
  }

  /* ---------------- 11. 全局遥控器按键中枢 ---------------- */
  function handleBackAction() {
    var kbMask = document.getElementById('tvModalKbMask');
    if (kbMask && !kbMask.classList.contains('hidden')) {
      closeModalKb(true);
      return true;
    }
    if (document.body.classList.contains('live-fs-mode')) {
      document.body.classList.remove('live-fs-mode');
      var lFsBtn = document.getElementById('liveFsBtn');
      if (lFsBtn && visible(lFsBtn)) setFocus(lFsBtn, true);
      return true;
    }
    if (isPlayRoute()) {
      var osd = document.getElementById('tvPlayerOsd');
      if (osd && osd.classList.contains('open')) {
        closePlayerOsd();
        return true;
      }
      if (document.body.classList.contains('tv-fs-mode')) {
        exitTvFullscreen();
        return true;
      }
    }
    var mask = document.querySelector('.modal-mask:not(.hidden)');
    if (mask) {
      var closeBtn = mask.querySelector('.modal-close, .btn-cancel, button');
      if (closeBtn) closeBtn.click();
      else mask.remove();
      return true;
    }
    var h = location.hash || '#/home';
    if (h !== '#/home' && h !== '#/' && h !== '') {
      if (window.history.length > 1) window.history.back();
      else location.hash = '#/home';
      return true;
    }
    return false;
  }

  window.__xlTvBack = function () {
    return handleBackAction() ? 1 : 0;
  };

  window.addEventListener('keydown', function (ev) {
    var k = ev.key;
    var code = ev.keyCode;

    var isBack = k === 'Escape' || k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack' || code === 4 || code === 461 || code === 10009;
    if (isBack) {
      if (handleBackAction()) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      return;
    }

    var dir = null;
    if (k === 'ArrowUp' || code === 19) dir = 'up';
    else if (k === 'ArrowDown' || code === 20) dir = 'down';
    else if (k === 'ArrowLeft' || code === 21) dir = 'left';
    else if (k === 'ArrowRight' || code === 22) dir = 'right';

    var isOk = k === 'Enter' || k === ' ' || code === 23 || code === 66;

    // 仅当在播放页且已进入全屏态 (tv-fs-mode) 时，才拦截方向键用于快进/快退与呼出 OSD 浮层
    if (isPlayRoute() && document.body.classList.contains('tv-fs-mode') && !document.querySelector('.modal-mask:not(.hidden)')) {
      var osd = document.getElementById('tvPlayerOsd');
      var video = document.getElementById('videoEl');
      var isOsdOpen = osd && osd.classList.contains('open');

      if (!isOsdOpen) {
        if (dir === 'left' || dir === 'right') {
          ev.preventDefault();
          ev.stopPropagation();
          if (video && video.duration) {
            var step = dir === 'right' ? 15 : -15;
            var targetTime = Math.min(video.duration - 0.5, Math.max(0, (video.currentTime || 0) + step));
            try { video.currentTime = targetTime; } catch (e) {}
            showCenterHud((step > 0 ? '⏩ 快进 15秒 · ' : '⏪ 快退 15秒 · ') + fmtTime(targetTime) + ' / ' + fmtTime(video.duration), 1400);
            scheduleHideHint(3500);
          }
          return;
        }
        if (dir === 'down' || dir === 'up' || k === 'ContextMenu' || code === 82) {
          ev.preventDefault();
          ev.stopPropagation();
          openPlayerOsd();
          return;
        }
        if (isOk) {
          ev.preventDefault();
          ev.stopPropagation();
          if (video) {
            if (video.paused) {
              video.play().catch(function () {});
              showCenterHud('▶ 继续播放', 900);
            } else {
              video.pause();
              showCenterHud('⏸ 已暂停 · 按 OK 键继续播放', 2500);
            }
            scheduleHideHint(4000);
          }
          return;
        }
      } else {
        bumpOsdTimer();
        if (dir) {
          ev.preventDefault();
          ev.stopPropagation();
          var curOsdFocus = osd.querySelector('.' + FOCUSED_CLS) || osd.querySelector('.tvo-pill');
          var nextOsd = pickNext(curOsdFocus, dir, osd);
          if (nextOsd) setFocus(nextOsd, false);
          return;
        }
        if (isOk) {
          ev.preventDefault();
          ev.stopPropagation();
          var actPill = osd.querySelector('.' + FOCUSED_CLS);
          if (actPill) actPill.click();
          return;
        }
      }
    }

    if (dir) {
      ev.preventDefault();
      ev.stopPropagation();
      var cur = document.querySelector('.' + FOCUSED_CLS);
      if (!cur || !visible(cur)) {
        cur = document.activeElement && visible(document.activeElement) ? document.activeElement : null;
      }
      var next = pickNext(cur, dir);
      if (next) setFocus(next, false);
      return;
    }

    if (isOk) {
      var focused = document.querySelector('.' + FOCUSED_CLS);
      if (focused && visible(focused)) {
        ev.preventDefault();
        ev.stopPropagation();
        if (focused.tagName === 'INPUT') {
          openModalKb(focused);
        } else {
          focused.click();
        }
      }
    }
  }, true);

  /* ---------------- 12. 启动与页面生命周期同步 ---------------- */
  function syncTvScreen() {
    tuneTopbar();
    syncTvPlayerMode();
    enhanceLivePage();

    var h = location.hash || '#/home';
    if (h === '#/search' || h.indexOf('#/search?') === 0) {
      var qm = h.match(/[?&]q=([^&]*)/);
      var qVal = qm ? decodeURIComponent(qm[1]) : '';
      mountTvSearch(qVal);
      return;
    } else {
      var view = document.getElementById('view');
      if (view && view.dataset.tvSearch === '1') view.dataset.tvSearch = '';
      clearInterval(tvPollTimer);
    }

    if (isHomeOrBrowse()) {
      ensureAuroraHero();
      setTimeout(checkAndFallbackLoadMovies, 1000);
    }
  }

  function bootTv() {
    syncTvScreen();

    var mo = new MutationObserver(function () {
      tuneTopbar();
      if (isPlayRoute()) {
        syncTvPlayerMode();
      } else if (isHomeOrBrowse()) {
        ensureAuroraHero();
      } else if ((location.hash || '').indexOf('#/live') === 0) {
        enhanceLivePage();
      }
    });
    var viewEl = document.getElementById('view');
    if (viewEl) {
      mo.observe(viewEl, { childList: true, subtree: true });
    }

    window.addEventListener('hashchange', function () {
      fallbackLoading = false;
      setTimeout(function () {
        syncTvScreen();
        var curF = document.querySelector('.' + FOCUSED_CLS);
        if (!curF || !visible(curF)) {
          var navAct = document.querySelector('#mainNav a.active') || document.querySelector('#mainNav a');
          if (navAct) setFocus(navAct, true);
        }
      }, 70);
    });

    window.addEventListener('xl:ready', function () {
      syncTvScreen();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootTv);
  } else {
    bootTv();
  }
})();
