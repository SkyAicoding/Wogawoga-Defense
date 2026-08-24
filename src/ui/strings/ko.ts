/**
 * 한국어 문자열 (기본 언어). en.ts와 키 셋이 완전히 일치해야 한다.
 * 키 규약: 화면.항목 / tower.<id>.name|desc / enemy.<id>.name|desc / stage.<id>.name
 */
export const ko: Record<string, string> = {
  // 로비 상단 띠에 쓰는 이름 — 한국어 화면에는 한국어 이름을 쓴다.
  // 타이틀 화면의 큰 로고는 아래 title.logo* 이고 그쪽은 **브랜드라 두 언어가 같다**.
  'app.name': '공룡의 시대',

  // 타이틀 로고 두 줄 — 고유명사라 ko/en 이 같은 글자다 (Age of Empires 의 로고 구조).
  // ⚠ 부족 이름 '와가와가'는 안 없앤다 — stage.1.name 에 그대로 살아 있고,
  //    흔한 제목에 고유한 얼굴을 붙이는 자리다.
  'title.logoTop': 'AGE OF',
  'title.logoBottom': 'DINOSAURS',
  'title.tapToStart': '탭하여 시작',
  'title.version': 'v{v}',

  'common.back': '뒤로',
  'common.ok': '확인',
  'common.cancel': '취소',
  'common.free': '무료',
  'common.max': '최대',
  'common.on': '켬',
  'common.off': '끔',

  'lobby.settings': '설정',
  'lobby.battle': '전투 시작!',
  'lobby.collection': '도감',
  'lobby.endless': '무한 모드',
  'lobby.endlessBest': '최고 {n}웨이브',
  'lobby.endlessNeedClear': '클리어 후 도전 가능',
  'lobby.progress': '웨이브 {n}/{m}',
  'lobby.cleared': '클리어!',
  'lobby.notStarted': '미도전',
  'lobby.locked': '스테이지 {n} 클리어 시 해금',
  'lobby.stageNo': '스테이지 {n}',

  'stage.1.name': '와가와가 초원',
  'stage.2.name': '우거진 정글',
  'stage.3.name': '이글이글 사막',
  'stage.4.name': '꽁꽁 설원',
  'stage.5.name': '부글부글 늪지',
  'stage.6.name': '으르렁 화산',

  'collection.title': '타워 도감',
  'collection.locked': '미보유',
  'collection.shards': '조각 {n}/{m}',
  'collection.starUp': '별 강화',
  'collection.cost': '조각 {s} · 호박 {a}',
  'collection.unlock': '해금하기',
  'collection.unlockAmber': '호박 {a}',
  'collection.unlockStage': '스테이지 {n} 클리어 시 해금',
  'collection.maxStar': '최대 강화 완료!',
  'collection.statDmg': '공격력',
  'collection.statRate': '공격 속도',
  'collection.statRange': '사거리',
  'collection.statCost': '배치 비용',
  'collection.statRateUnit': '{n}회/초',
  'collection.starBonusTitle': '별 1개당 보너스',
  'collection.bonusDmg': '공격력 +{n}%',
  'collection.bonusRate': '공속 +{n}%',
  'collection.bonusRange': '사거리 +{n}%',
  'collection.fxTitle': '특수 효과',
  'collection.fxSplash': '범위 피해',
  'collection.fxChain': '연쇄 공격',
  'collection.fxAuraDmg': '주변 지속 피해',
  'collection.fxAuraBuff': '주변 타워 강화',
  'collection.fxStatus.slow': '감속',
  'collection.fxStatus.burn': '화상',
  'collection.fxStatus.poison': '중독',
  'collection.fxStatus.stun': '기절',

  'settings.title': '설정',
  'settings.music': '음악',
  'settings.sfx': '효과음',
  'settings.lang': '언어',
  'settings.vibration': '진동',
  'settings.quality': '그래픽 품질',
  'settings.quality.auto': '자동',
  'settings.quality.low': '낮음',
  'settings.quality.med': '중간',
  'settings.quality.high': '높음',
  'settings.unlockAll': '모든 스테이지 열기',
  'settings.unlockAllDesc':
    '잠금과 상관없이 6개 스테이지와 무한 모드를 바로 플레이합니다. 진행도와 호박은 그대로 유지됩니다.',
  'settings.reset': '데이터 초기화',
  'settings.resetBody1': '모든 진행 상황이 삭제됩니다. 계속할까요?',
  'settings.resetBody2': '정말로요? 삭제하면 되돌릴 수 없어요!',
  'settings.resetFinal': '전부 삭제',
  'settings.credits': '모든 그래픽과 사운드는 코드로 만들었습니다.\n광고도 결제도 없는 무료 게임입니다.',

  'battle.wave': '웨이브',
  'battle.callWave': '웨이브 시작',
  'battle.earlyBonus': '조기 보너스 +{g}',
  'battle.prep': '{s}초 후 자동 시작',
  'battle.refresh': '새로고침',
  'battle.upgrade': '강화',
  'battle.sell': '판매',
  'battle.lv': 'Lv.{n}',
  'battle.targeting.first': '선두 우선',
  'battle.targeting.last': '후미 우선',
  'battle.targeting.strongest': '강한 적 우선',
  'battle.targeting.nearest': '가까운 적 우선',
  'battle.paused': '일시정지',
  'battle.resume': '계속하기',
  'battle.quit': '포기하기',
  'battle.quitBody': '전투를 포기하고 로비로 나갈까요?',
  'battle.auto': '자동',
  'battle.scenery.title': '방해 지형지물',
  'battle.scenery.desc': '치우면 이 자리에 타워를 지을 수 있어요',
  'battle.scenery.clear': '치우기',
  'battle.scenery.confirm': '정말?',
  'battle.scenery.confirmDesc': '한 번 더 누르면 {n} 골드가 빠져요 (되돌릴 수 없음)',
  'battle.scenery.needGold': '골드 {n} 부족',
  'battle.close': '닫기',
  'battle.lvOf': 'Lv.{n}/{m}',
  'battle.home.title': '홈타운',
  // 정원 = 마을이 동시에 내보낼 수 있는 부족원 수 (sim/hometown.ts allyCapFor).
  // 이 줄에 없으면 "마을을 키우면 부족원이 늘어난다"는 설계가 화면 어디에도 없다.
  // ⚠ 9단계까지 이 자리는 '출격거리'였다 — 값은 정원으로 바뀌었는데 라벨만 남아
  //   화면이 '출격거리 2'라고 말하고 있었다(검증에서 실측으로 잡혔다).
  'battle.home.stats': '체력 {hp} · 사거리 {r} · 부족원 {s}',
  'battle.home.desc': '올리면 체력·공격력·사거리와 부족원 정원이 함께 커져요',
  'battle.home.next': '올리면 → 체력 {hp} · 공격 {d} · 사거리 {r} · 부족원 {s}',
  'battle.home.confirmDesc': '한 번 더 누르면 {n} 골드가 빠져요 (되돌릴 수 없음)',
  'battle.home.maxed': '더 키울 수 없어요 (최대 단계)',
  'battle.ally.title': '부족 출동',
  // 상단 부족 칩 — 인원 표시이자 마을 패널로 가는 입구다 (출동 버튼은 패널 안에만 있다)
  'battle.ally.pillHint': '나가 있는 부족원 — 눌러서 마을 열기 (출동·강화)',
  // 네 종이 공유하는 규칙 — 버튼마다 네 번 적지 않고 여기 한 줄로 모은다.
  // ⚠ **기기마다 조작이 다르다**(game/placement.ts 헤더). 그래서 줄도 둘이다 —
  //   한 줄에 둘을 다 적으면 어느 쪽 사람도 자기 것을 못 찾는다.
  //   고르는 값은 core/device.ts의 isCoarsePointer이고, 실제 명령 갈래는 그 값을 안 본다.
  'battle.ally.rulesMouse': '부족원을 좌클릭하면 같은 종족이 모두 선택돼요 → 우클릭으로 이동·채집·공격 · {m}명까지',
  'battle.ally.rulesTouch': '판에서 부족원을 탭하면 같은 종족이 모두 선택돼요 → 갈 칸을 탭하면 이동·채집·공격 · {m}명까지',
  // 자동 행동 한 줄 — 사용자 지시 ②③④가 여기 다 들어간다.
  // "빈 칸을 찍으면 지킨다"와 "마을을 찍으면 다시 알아서 한다"가 짝이라 한 문장에 있다.
  'battle.ally.rulesAuto': '채집꾼은 시키지 않아도 가까운 자원부터 알아서 캐요 · 빈 칸을 찍으면 그 자리를 지켜요 · 마을을 찍으면 다시 알아서 일해요',
  // 파수꾼 전용 배지 — 이 카드만 타워 화력의 곱셈 인자다 (sunder, 단계 3).
  // 짧아야 하는 자리라 "무엇을"만 적고 "왜"는 아래 안내 줄이 받는다.
  'battle.ally.sunder': '가죽을 열어요',
  'battle.ally.sunderHint': '이 부족원이 붙잡은 적은 가죽 상한이 사라져요 (큰 한 방이 그대로 들어가요)',
  'ally.clubber.name': '몽둥이꾼',
  // 마릿수는 balance.ALLY_BLOCK_CAPACITY 에서 넘어온다 (규칙이 바뀌면 문구도 따라 바뀐다)
  'ally.clubber.desc': '싸고 발 빠른 근접. 최대 {n}마리의 발을 묶어요',
  'ally.slinger.name': '돌팔매꾼',
  'ally.slinger.desc': '뒤에서 던져요. 공중도 맞히지만 아무도 막지 못해요',
  'ally.guardian.name': '파수꾼',
  'ally.guardian.desc': '방패와 갑옷. {n}마리에게 둘러싸여도 오래 버텨요',

  // --- 채집꾼 (넷째 부족) -----------------------------------------------------
  // 싸우지 않는 카드다 — 파는 것이 화력이 아니라 **가격과 손**이라는 것을 문구가 먼저 말한다.
  // {g} = 채집 배수(gatherPct/100) · {c} = 질 수 있는 짐(carryCap). battlehud의 allyDesc가 넣는다.
  'ally.gatherer.name': '채집꾼',
  'ally.gatherer.desc': '캐는 손이 {g}배 빨라요. 짐도 {c}개까지 져요. 대신 싸움에는 못 나서요',

  // --- 자원 8종 (docs/gather-spec.md §7-4) ------------------------------------
  // 부제는 **두 축만** 말한다: 캐는 시간과 짐 값. 종류가 가르는 것이 그 둘뿐이기 때문이다(D2).
  'res.berry.name': '딸기 덤불',
  'res.berry.tag': '가장 빨리 캐요. 대신 값이 제일 싸요',
  'res.mushroom.name': '버섯 무리',
  'res.mushroom.tag': '금방 캐고 값도 낮은 편이에요',
  'res.honey.name': '벌집',
  'res.honey.tag': '캐는 시간도 값도 딱 중간이에요',
  'res.fruit.name': '열매나무',
  'res.fruit.tag': '나무 하나에 열매가 잔뜩 달렸어요',
  'res.flint.name': '부싯돌',
  'res.flint.tag': '돌치고는 빨리 캐져요',
  'res.wood.name': '통나무',
  'res.wood.tag': '무난해요. 어디서나 나요',
  'res.stone.name': '돌무더기',
  'res.stone.tag': '오래 걸려요. 대신 값이 나가요',
  'res.obsidian.name': '흑요석',
  'res.obsidian.tag': '가장 오래 걸리고 가장 값나가요',

  // --- 자원 패널 --------------------------------------------------------------
  // ⚠ 주제 문장이 '치우면 타워를 지을 수 있어요'가 **아니다**(D1: 다 캐도 칸은 안 열린다).
  //   캐는 것과 치우는 것은 서로 다른 일이고, 이 패널은 그 둘을 한 자리에서 갈라 말한다.
  'battle.res.desc': '캐서 마을까지 지고 오면 코인이 들어와요',
  'battle.res.value': '이 짐은 코인 {g}',
  'battle.res.time': '캐기 {s}초 · 마을까지 {w}초',
  'battle.res.send': '채집 보내기',
  'battle.res.sendNone': '보낼 사람이 없어요 — 마을에서 채집꾼을 뽑으세요',
  'battle.res.handsFull': '다들 짐을 지고 있어요 — 마을로 보내 내려놓게 하세요',
  'battle.res.taken': '이미 텄어요 — 그루터기만 남았어요',
  // 조사는 '이'로 고정한다 — 아군 4종이 전부 '…꾼'(받침 ㄴ)이라 '(가)'는 절대 안 쓰인다.
  // 안 쓰이는 선택지를 화면에 남기면 사용자만 그 괄호를 읽는다.
  'battle.res.claimed': '{n}이 캐러 가는 중이에요',
  // §4-4의 규칙을 화면이 말하는 유일한 자리다 — 이 한 줄이 없으면
  // "맞으면 멈추는 것"과 "짐은 안 놓치는 것"이 플레이어에게는 랜덤으로 읽힌다.
  'battle.res.fightFirst': '맞으면 캐던 손이 멈춰요. 지고 있는 짐은 안 놓쳐요',
  // D1이 만든 기회비용 — 안 턴 칸을 치우면 그 짐을 버리는 것이다
  'battle.res.clearWarn': '여기 짐 {g}코인을 버려요',

  // --- 부족 패널 (채집) -------------------------------------------------------
  'battle.ally.gather': '채집 특화',
  'battle.ally.gatherHint': '자원 칸을 찍으면 다른 부족원보다 {g}배 빨리 캐고 짐을 {c}개까지 져요',
  // 두 조각을 갈라 둔다 — 아무도 안 캐는데 '0명 채집 중'이 뜨면 거짓말이다.
  // 호출부가 값이 0인 조각을 빼고 ' · '로 잇는다.
  'battle.ally.gathering': '⛏ {n}명 채집 중',
  'battle.ally.carrying': '짐 {c}',
  // 대기 인원 — 머리 위 말뚝(healthbars kind 8)과 **같은 사실**을 숫자로도 말한다.
  // 판에서 표식을 못 보고 "왜 안 움직이지"만 남는 경우를 이 줄이 받는다.
  // ⚠ **일꾼만 센다**(§D-3) — 자동이 없는 전투 3종에게 '대기'는 상태가 아니라 상수다.
  'battle.ally.holding': '📍 {n}명 대기',
  // 대기 중인 사람이 **등에 지고 있는** 골드 (§D-2). "여기 지켜"는 짐도 함께 세우므로
  // 그 골드는 배달될 때까지 안 들어온다 — 규칙은 그게 맞고, 이 줄이 그 사실을 말한다.
  // '묶임'을 고른 이유: '보관 중'은 안전해 보이고 '못 받음'은 버그처럼 읽힌다.
  // 지금 사용자가 풀 수 있는 상태라는 뜻이 나와야 한다(그 사람을 마을로 보내면 풀린다).
  'battle.ally.heldGold': '📦 {g}코인 묶임',
  'battle.ally.rulesGather': '알아서 가까운 자원부터 캐요 · 찍어 주면 그 칸을 먼저 캐요',

  // --- 첫 사용자 안내 (배너 1회) ----------------------------------------------
  // 조작이 기기마다 갈리므로 안내도 갈린다 (battle.ally.rules* 와 같은 규약)
  'battle.hint.gatherMouse': '🍓 부족원을 좌클릭하고 나무를 우클릭해 보세요 — 캐서 마을로 지고 오면 코인이 들어와요',
  'battle.hint.gatherTouch': '🍓 부족원을 탭하고 나무를 찍어 보세요 — 캐서 마을로 지고 오면 코인이 들어와요',

  // --- 웨이브 미리보기 띠 (prep 전용) --------------------------------------
  // 칩에는 **적 이름을 쓰지 않는다** — '안킬로사우루스'가 390px에서 깨진다.
  // 이름은 탭 후 상세에만 나오고, 칩은 아이콘 + 마릿수 + 특성 배지로만 말한다.
  'battle.preview.title': '다음 웨이브',
  'battle.preview.expand': '자세히 보기',
  'battle.preview.collapse': '접기',
  'battle.preview.demand': '내 타워가 얼마나 듣나',
  'battle.preview.more': '+{n}종',
  'battle.preview.hp': '체력 {n} × {c}마리',
  'battle.preview.good': '잘 들어요',
  'battle.preview.bad': '안 들어요',
  // 없는 답을 알려주는 것은 정보가 아니라 좌절이다 — 그래서 **내 덱 안**에서만 찾는다
  'battle.preview.noAnswer': '지금 덱에는 잘 듣는 카드가 없어요',
  'battle.preview.plain': '특별한 방어는 없어요',
  'battle.preview.weakVs': '{n} 상대로 약해요',

  // 특성 — 이름은 배지에, 설명은 상세 한 줄에 쓴다
  'trait.air.name': '하늘',
  'trait.air.desc': '날아서 지나가요 — 공중을 때리는 타워만 닿아요',
  'trait.shield.name': '방패',
  'trait.shield.desc': '처음 몇 대를 통째로 무시해요 — 자주 때려서 벗겨내세요',
  'trait.armor.name': '장갑',
  'trait.armor.desc': '한 대마다 {n}씩 깎여요 — 작게 여러 번 때리는 타워가 손해예요',
  'trait.hide.name': '가죽',
  'trait.hide.desc': '한 대에 {n}까지만 들어가요 — 크게 한 방 때리는 타워가 손해예요',
  'trait.splash.name': '흩어짐',
  'trait.splash.desc': '터지는 피해가 잘 안 들어가요 — 폭발 말고 직접 때리세요',
  'trait.heal.name': '치유',
  'trait.heal.desc': '주변 동료를 계속 되살려요 — 이쪽을 먼저 잡으세요',
  'trait.raid.name': '습격',
  'trait.raid.desc': '기지가 아니라 내 타워를 부수러 와요 — 길에서 떨어뜨려 지으세요',
  'trait.enrage.name': '격노',
  'trait.enrage.desc': '체력이 떨어지면 훨씬 빨라져요 — 느리게 만들어 두세요',

  'battle.waveBanner': '웨이브 {n}',
  'battle.finalWaveBanner': '마지막 웨이브!',
  'battle.bossBanner': '보스 출현!',

  'result.victory': '승리!',
  'result.defeat': '패배…',
  'result.wave': '도달 웨이브',
  'result.kills': '처치',
  'result.amber': '호박',
  'result.shards': '타워 조각',
  'result.retry': '다시하기',
  'result.lobby': '로비로',
  'result.next': '다음 스테이지',
  'result.firstClear': '첫 클리어 보너스!',
  'result.endless': '무한 모드',

  'tower.spear.name': '창던지기 움막',
  'tower.spear.desc': '부족 사냥꾼이 창을 슝슝! 값싸고 어디서나 든든한 기본 타워.',
  'tower.catapult.name': '돌 투석기',
  'tower.catapult.desc': '큰 바위를 날려 뭉친 적을 한꺼번에! 공중의 적은 맞히지 못해요.',
  'tower.lightning.name': '번개 토템',
  'tower.lightning.desc': '찌릿! 번개가 적 사이를 튀며 연쇄 피해를 줘요.',
  'tower.brazier.name': '화염 모닥불',
  'tower.brazier.desc': '주변의 적을 계속 태우는 불의 오라. 가까이 오면 뜨거워요!',
  'tower.frost.name': '얼음 크리스탈',
  'tower.frost.desc': '차가운 기운으로 적의 발을 꽁꽁 얼려 느리게 만들어요.',
  'tower.poison.name': '독가시 덩굴',
  'tower.poison.desc': '독가시를 쏘아 중독시켜요. 맞은 적은 서서히 아파요.',
  'tower.ballista.name': '상아 발리스타',
  'tower.ballista.desc': '거대한 상아 화살로 단일 적에게 강력한 한 방!',
  'tower.drum.name': '전쟁북',
  'tower.drum.desc': '둥둥둥! 북소리로 주변 타워의 공격력과 속도를 올려줘요.',

  'enemy.raptor.name': '랩터',
  'enemy.raptor.desc': '빠른 발로 달려드는 성질 급한 사냥꾼.',
  'enemy.compy.name': '콤피 떼',
  'enemy.compy.desc': '작지만 숫자로 밀어붙이는 꼬마 공룡 무리.',
  'enemy.trike.name': '트리케라톱스',
  'enemy.trike.desc': '세 개의 뿔과 단단한 몸집의 탱커.',
  'enemy.ptera.name': '프테라노돈',
  'enemy.ptera.desc': '하늘로 날아 지상 공격을 피해 다녀요.',
  'enemy.ankylo.name': '안킬로사우루스',
  'enemy.ankylo.desc': '갑옷 같은 등딱지로 피해를 줄여요.',
  'enemy.boar.name': '원시 멧돼지',
  'enemy.boar.desc': '다치면 더 빨라지는 성난 멧돼지.',
  'enemy.warrior.name': '부족 전사',
  'enemy.warrior.desc': '방패로 몇 번의 공격을 막아내요. 멈춰 서서 창을 던지기도 해요.',
  'enemy.shaman.name': '부족 주술사',
  'enemy.shaman.desc': '주변 동료를 치유하는 성가신 주술사.',
  'enemy.blade.name': '부족 투창병',
  'enemy.blade.desc': '제일 먼저 달려와 멈춰 서서 짧은 창을 쉴 새 없이 던져요!',
  'enemy.lancer.name': '부족 큰창잡이',
  'enemy.lancer.desc': '버티고 서서 무거운 장창을 던져요. 가죽갑옷 덕에 오래 버텨요.',
  'enemy.archer.name': '부족 궁수',
  'enemy.archer.desc': '멀리서 멈춰 서서 활을 쏘아 타워를 갉아요. 몸은 약해요.',
  'enemy.hexer.name': '부족 주술 저주사',
  'enemy.hexer.desc': '가장 멀리서 저주를 던져 타워를 잠시 침묵시켜요. 저주에 걸린 타워는 쏘지 못해요!',
  'enemy.mammoth.name': '매머드',
  'enemy.mammoth.desc': '땅을 울리며 걷는 거대한 털북숭이.',
  'enemy.spino.name': '스피노사우루스',
  'enemy.spino.desc': '등지느러미를 세운 사나운 미니보스.',
  'enemy.trex.name': '티라노사우루스',
  'enemy.trex.desc': '모든 것을 짓밟는 폭군, 최종 보스.',
  'enemy.golem.name': '화산 골렘',
  'enemy.golem.desc': '용암이 흐르는 바위 거인. 화산에서만 나타나요.',
};
