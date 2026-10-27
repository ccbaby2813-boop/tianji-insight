/* eslint-disable */
// config/wuxing-relation-en.js - 五行生克关系矩阵英文版（键/type/guaOrgan 中文保留供内部查询，typeEn 供输出）
// 由 scripts/gen-en-files.js 自动生成（2026-08-19T14:28:02.566Z），请勿手工编辑
module.exports = {
  "RELATION_TYPE_EN": {
    "同气": "Same Element",
    "我生": "Generating",
    "生我": "Receiving",
    "克我": "Controlling",
    "我克": "Overcoming"
  },
  "RELATION_TYPE_STRATEGY": {
    "同气": {
      "type": "Same Element",
      "desc": "The Five-Element nature of the hexagram pattern matches that of the seasonal node. Like qi seeks like; when the qi is excessive, it becomes hyperactive, so the overabundance must be tempered.",
      "principle": "Focus on calming and suppressing; drain the excess to prevent hyperactivity.",
      "classicQuote": "When there is hyperactivity, harm ensues; the responsive qi brings restraint; with restraint, generation and transformation are achieved.",
      "classicSource": "Plain Questions (Su Wen) · Great Discussion on the Six Subtle Principles"
    },
    "我生": {
      "type": "Generating",
      "desc": "The Five-Element of the hexagram pattern generates that of the seasonal node; the mother qi drains into the child, so we release qi deliberately to nourish the child.",
      "principle": "Drain the mother to nurture the child; flow with the trend, but do not let the mother qi become too depleted.",
      "classicQuote": "In deficiency, tonify the mother; in excess, drain the child.",
      "classicSource": "Classic of Difficulties (Nan Jing) · Sixty-Ninth Difficulty"
    },
    "生我": {
      "type": "Receiving",
      "desc": "The seasonal node's Five-Element generates that of the hexagram pattern; receiving the mother qi's nourishment, the original qi is replenished.",
      "principle": "Tonify the mother and benefit the child; use the supportive trend to strengthen the root, and supplement accordingly.",
      "classicQuote": "To cure disease, one must seek the root.",
      "classicSource": "Plain Questions (Su Wen) · Great Discussion on the Correspondence of Yin and Yang"
    },
    "克我": {
      "type": "Controlling",
      "desc": "The seasonal node's Five-Element overcomes that of the hexagram pattern; the original qi is restricted, so we must protect it from being overcome and harmed.",
      "principle": "Protect the root and guard against being overcome; fortify earth to generate metal (as an analogy), support the upright to fend off the harmful.",
      "classicQuote": "Where evil gathers, the qi there must be deficient.",
      "classicSource": "Plain Questions (Su Wen) · Discussion on Febrile Diseases"
    },
    "我克": {
      "type": "Overcoming",
      "desc": "The hexagram pattern's Five-Element overcomes that of the seasonal node; balance the seasonal qi, but do not attack excessively.",
      "principle": "Maintain balance with restraint; avoid excessive overcoming; also attend to the side that is being overcome.",
      "classicQuote": "Wood, meeting metal, is felled; fire, meeting water, is quenched; earth, meeting wood, is broken; metal, meeting fire, is melted; water, meeting earth, is stopped.",
      "classicSource": "Plain Questions (Su Wen) · Discussion on Preserving Life and Completing the Body"
    }
  },
  "WUXING_RELATION": {
    "木-木": {
      "type": "同气",
      "typeEn": "Same Element",
      "title": "Double Wood Stacking",
      "sub": "Like qi attracts like — liver qi tends to run high; guard against excess.",
      "warning": "The hexagram element is Wood and the seasonal element is also Wood. Two Woods combine, making liver qi hyperactive. Guard against liver yang rising, dizziness, blurred vision, and irritability.",
      "principle": "Soothe the liver and calm it, soften the liver and nourish blood, keep Wood from flourishing and generating wind.",
      "strategy": [
        "Soothe liver and regulate qi",
        "Calm liver and subdue yang",
        "Nourish blood and soften liver"
      ],
      "guaOrgan": "肝",
      "termOrgan": "肝"
    },
    "木-火": {
      "type": "我生",
      "typeEn": "Generating",
      "title": "Wood and Fire in Mutual Generation",
      "sub": "Wood feeds Fire — drain Wood to nourish Fire; go with the momentum.",
      "warning": "The hexagram Wood generates the seasonal Fire, so Wood is drained by Fire. Liver Wood's dredging and draining become excessive, easily leading to liver blood deficiency and heart fire flaring upward.",
      "principle": "Drain Wood to nourish Fire, enrich Water to nourish Wood, and never let Wood qi become too depleted.",
      "strategy": [
        "Nourish yin and blood",
        "Clear heart and drain fire",
        "Soothe liver and drain heat"
      ],
      "guaOrgan": "肝",
      "termOrgan": "心"
    },
    "木-土": {
      "type": "我克",
      "typeEn": "Overcoming",
      "title": "Wood and Earth in Mutual Control",
      "sub": "Wood controls Earth — liver Wood impinges on the spleen; protect the spleen from being dominated.",
      "warning": "The hexagram Wood controls the seasonal Earth, and Wood in excess overwhelms Earth. Liver Wood attacks Spleen Earth transversely, easily causing spleen failing to transport, abdominal distension, and poor appetite.",
      "principle": "Suppress Wood and support Earth, soothe the liver and strengthen the spleen, and keep the balance in check.",
      "strategy": [
        "Soothe liver and strengthen spleen",
        "Regulate qi and harmonize the middle",
        "Reinforce Earth and suppress Wood"
      ],
      "guaOrgan": "肝",
      "termOrgan": "脾"
    },
    "木-金": {
      "type": "克我",
      "typeEn": "Controlling",
      "title": "Metal and Wood in Mutual Control",
      "sub": "Metal controls Wood — Lung Metal controls Liver Wood; shield the liver from being controlled.",
      "warning": "The seasonal Metal controls the hexagram Wood, and Metal in excess attacks Wood. Lung Metal's descending, cleansing qi suppresses Liver Wood, easily causing liver qi stagnation, emotional unease, and distending pain in the flanks.",
      "principle": "Protect the liver from domination, enrich Water to nourish Wood, and let Metal and Water generate each other to soften the control.",
      "strategy": [
        "Nourish blood and soften liver",
        "Nourish yin and moisten lung",
        "Soothe liver and relieve depression"
      ],
      "guaOrgan": "肝",
      "termOrgan": "肺"
    },
    "木-水": {
      "type": "生我",
      "typeEn": "Receiving",
      "title": "Water and Wood in Mutual Generation",
      "sub": "Water generates Wood — Kidney Water nourishes Liver Wood; tonify the mother to benefit the child.",
      "warning": "The seasonal Water generates the hexagram Wood, so it receives the mother's nourishing qi. Liver Wood obtains Kidney Water's nourishment, replenishing its root qi, but beware of Wood floating when Water is excessive.",
      "principle": "Enrich Water to nourish Wood, tonify the mother to benefit the child, and follow the momentum to strengthen the root.",
      "strategy": [
        "Nourish yin and tonify kidney",
        "Nourish blood and soften liver",
        "Reinforce root and secure origin"
      ],
      "guaOrgan": "肝",
      "termOrgan": "肾"
    },
    "火-木": {
      "type": "生我",
      "typeEn": "Receiving",
      "title": "Wood and Fire in Mutual Generation",
      "sub": "Wood generates Fire — Liver Wood nourishes Heart Fire; tonify the mother to benefit the child.",
      "warning": "The seasonal Wood generates the hexagram Fire, so it receives the mother's nourishing qi. Heart Fire is nourished by Liver Wood, replenishing its root qi, but guard against Wood excess driving Fire to flare.",
      "principle": "Tonify the mother to benefit the child, enrich Water to control Fire, and follow the momentum to strengthen the root.",
      "strategy": [
        "Nourish blood and calm heart",
        "Soothe liver and regulate qi",
        "Nourish yin and descend fire"
      ],
      "guaOrgan": "心",
      "termOrgan": "肝"
    },
    "火-火": {
      "type": "同气",
      "typeEn": "Same Element",
      "title": "Double Fire Stacking",
      "sub": "Like qi attracts like — heart fire easily becomes hyperactive; guard against excess.",
      "warning": "The hexagram element is Fire and the seasonal element is also Fire. Two Fires combine, making heart fire hyperactive. Guard against restlessness, insomnia, mouth sores, and short, dark urine.",
      "principle": "Clear the heart and descend fire, nourish yin and calm the spirit, and prevent fire from flaring and harming yin.",
      "strategy": [
        "Clear heart and drain fire",
        "Nourish yin and calm spirit",
        "Remove restlessness and quiet the heart"
      ],
      "guaOrgan": "心",
      "termOrgan": "心"
    },
    "火-土": {
      "type": "我生",
      "typeEn": "Generating",
      "title": "Fire and Earth in Mutual Generation",
      "sub": "Fire generates Earth — Heart Fire assists Spleen Earth; drain Fire to strengthen the Spleen.",
      "warning": "The hexagram Fire generates the seasonal Earth, so Fire is drained by Earth. Heart Fire drains into Spleen Earth, easily causing heart qi deficiency and prevailing spleen dampness.",
      "principle": "Drain fire to strengthen the spleen, nourish the heart and supplement qi, and never let fire qi become too depleted.",
      "strategy": [
        "Strengthen spleen and dispel dampness",
        "Nourish heart and supplement qi",
        "Clear heat and dry dampness"
      ],
      "guaOrgan": "心",
      "termOrgan": "脾"
    },
    "火-金": {
      "type": "我克",
      "typeEn": "Overcoming",
      "title": "Fire and Metal in Mutual Control",
      "sub": "Fire controls Metal — Heart Fire controls Lung Metal; protect the lung from being controlled.",
      "warning": "The hexagram Fire controls the seasonal Metal, and Fire in excess attacks Metal. Heart Fire invades Lung Metal, easily causing lung dryness with cough, dry cough with little phlegm, and dry skin.",
      "principle": "Clear fire to protect Metal, nourish yin and moisten the lung, and keep the balance in check.",
      "strategy": [
        "Clear heart and moisten lung",
        "Nourish yin and descend fire",
        "Nourish lung and protect Metal"
      ],
      "guaOrgan": "心",
      "termOrgan": "肺"
    },
    "火-水": {
      "type": "克我",
      "typeEn": "Controlling",
      "title": "Fire-Water Conflict",
      "sub": "Water controls Fire: Kidney Water restrains Heart Fire. Guard the Heart against constraint.",
      "warning": "The season's Water overcomes your trigram's Fire. With Water at full strength, it attacks Fire. Cold Kidney Water suppresses Heart Fire, readily causing Heart Yang debility, cold extremities, and low spirits.",
      "principle": "Protect the Heart from constraint, warm Yang to transform Qi, and link the Heart and Kidney.",
      "strategy": [
        "Warm and unblock Heart Yang",
        "Connect Heart and Kidney",
        "Warm Yang and dispel Cold"
      ],
      "guaOrgan": "心",
      "termOrgan": "肾"
    },
    "土-木": {
      "type": "克我",
      "typeEn": "Controlling",
      "title": "Wood-Earth Conflict",
      "sub": "Wood controls Earth: Liver Wood restrains Spleen Earth. Strengthen the Spleen against constraint.",
      "warning": "The season's Wood overcomes your trigram's Earth. With Wood rampant, it attacks Earth. Liver Wood invades Spleen Earth, readily causing Spleen transport failure, abdominal distension, and indigestion.",
      "principle": "Strengthen the Spleen against constraint, bank up Earth to restrain Wood, and fortify upright Qi to repel evil.",
      "strategy": [
        "Strengthen Spleen and boost Qi",
        "Soothe Liver and harmonize Stomach",
        "Bank up Earth and restrain Wood"
      ],
      "guaOrgan": "脾",
      "termOrgan": "肝"
    },
    "土-火": {
      "type": "生我",
      "typeEn": "Receiving",
      "title": "Fire-Earth Generation",
      "sub": "Fire generates Earth: Heart Fire nourishes Spleen Earth. Tonify the Mother to benefit the Child.",
      "warning": "The season's Fire generates your trigram's Earth, receiving the Mother's nourishing Qi. Spleen Earth gains from Heart Fire, replenishing its root Qi. Still, guard against excessive Fire drying the Earth.",
      "principle": "Tonify the Mother to benefit the Child, strengthen Spleen and harmonize Stomach, and follow the trend to cultivate the root.",
      "strategy": [
        "Strengthen Spleen and harmonize Stomach",
        "Nourish Heart and calm Spirit",
        "Clear Heat and moisten Dryness"
      ],
      "guaOrgan": "脾",
      "termOrgan": "心"
    },
    "土-土": {
      "type": "同气",
      "typeEn": "Same Element",
      "title": "Double Earth",
      "sub": "Like Qi seeks like; the Spleen tends toward Dampness. Guard against Dampness trapping the Spleen.",
      "warning": "Your trigram is Earth, and the season is also Earth. Two Earths combine, making Spleen Dampness predominant. Guard against Dampness trapping Spleen Yang, heavy limbs, and loss of appetite.",
      "principle": "Strengthen Spleen and dry Dampness, transform and transport water-damp, and prevent Dampness from obstructing the Middle Burner.",
      "strategy": [
        "Strengthen Spleen and dispel Dampness",
        "Use aromatics to transform Dampness",
        "Warm the Middle and dry Dampness"
      ],
      "guaOrgan": "脾",
      "termOrgan": "脾"
    },
    "土-金": {
      "type": "我生",
      "typeEn": "Generating",
      "title": "Earth-Metal Generation",
      "sub": "Earth generates Metal: Spleen Earth supports Lung Metal. Drain Earth to nourish Metal.",
      "warning": "Your trigram's Earth generates the season's Metal, so Earth is drained by Metal. Spleen Earth drains into Lung Metal, readily causing Spleen Qi deficiency and Lung Qi excess.",
      "principle": "Drain Earth to nourish Metal, strengthen Spleen and boost Qi, and bank up Earth to generate Metal.",
      "strategy": [
        "Strengthen Spleen and boost Qi",
        "Bank up Earth to generate Metal",
        "Moisten Lung and nourish Yin"
      ],
      "guaOrgan": "脾",
      "termOrgan": "肺"
    },
    "土-水": {
      "type": "我克",
      "typeEn": "Overcoming",
      "title": "Earth-Water Conflict",
      "sub": "Earth controls Water: Spleen Earth restrains Kidney Water. Guard the Kidney against constraint.",
      "warning": "Your trigram's Earth overcomes the season's Water. With Earth strong, it attacks Water. Spleen Earth invades Kidney Water, readily causing Kidney Water insufficiency, weak lower back and knees, and difficult urination.",
      "principle": "Control Water to protect the Kidney, strengthen Spleen and warm Yang, and maintain balanced restraint.",
      "strategy": [
        "Strengthen Spleen and promote diuresis",
        "Warm Kidney and transform Qi",
        "Bank up Earth to control Water"
      ],
      "guaOrgan": "脾",
      "termOrgan": "肾"
    },
    "金-木": {
      "type": "我克",
      "typeEn": "Overcoming",
      "title": "Metal-Wood Conflict",
      "sub": "Metal controls Wood: Lung Metal restrains Liver Wood. Guard the Liver against constraint.",
      "warning": "Your trigram's Metal overcomes the season's Wood. With Metal strong, it attacks Wood. Lung Metal's descending harshness invades Liver Wood, readily causing Liver Qi stagnation, emotional discomfort, and distending pain in both hypochondria.",
      "principle": "Control Wood to protect the Liver, clear the Lung and soothe the Liver, and maintain balanced restraint.",
      "strategy": [
        "Clear Lung and soothe Liver",
        "Nourish Blood and soften Liver",
        "Regulate Qi and resolve depression"
      ],
      "guaOrgan": "肺",
      "termOrgan": "肝"
    },
    "金-火": {
      "type": "克我",
      "typeEn": "Controlling",
      "title": "Fire-Metal Conflict",
      "sub": "Fire controls Metal: Heart Fire restrains Lung Metal. Guard the Lung against constraint.",
      "warning": "The season's Fire overcomes your trigram's Metal. With Fire strong, it attacks Metal. Heart Fire invades Lung Metal, readily causing Lung dryness with cough, dry cough with little phlegm, and dry throat and mouth.",
      "principle": "Protect the Lung from constraint, nourish Yin and descend Fire, and clear the Heart and moisten the Lung.",
      "strategy": [
        "Nourish Yin and moisten Lung",
        "Clear Heart and descend Fire",
        "Cultivate Yin and protect Lung"
      ],
      "guaOrgan": "肺",
      "termOrgan": "心"
    },
    "金-土": {
      "type": "生我",
      "typeEn": "Receiving",
      "title": "Earth-Metal Generation",
      "sub": "Earth generates Metal: Spleen Earth nourishes Lung Metal. Tonify the Mother to benefit the Child.",
      "warning": "The season's Earth generates your trigram's Metal, receiving the Mother's nourishing Qi. Lung Metal gains from Spleen Earth, replenishing its root Qi. Still, guard against excessive Earth burying Metal.",
      "principle": "Tonify the Mother to benefit the Child, bank up Earth to generate Metal, and follow the trend to cultivate the root.",
      "strategy": [
        "Bank up Earth to generate Metal",
        "Strengthen Spleen and boost Qi",
        "Moisten Lung and nourish Yin"
      ],
      "guaOrgan": "肺",
      "termOrgan": "脾"
    },
    "金-金": {
      "type": "同气",
      "typeEn": "Same Element",
      "title": "Double Metal",
      "sub": "Like qi attracts like; lung qi tends to become hyperactive, so guard against excessive dryness.",
      "warning": "The hexagram element is Metal, and the season is also Metal. Double Metal makes lung qi predominant. Guard against lung dryness harming yin, dry cough with scant phlegm, and dry skin.",
      "principle": "Moisten the lungs and dissipate nodules, nourish yin and moisten dryness, prevent Metal dryness from harming yin.",
      "strategy": [
        "Nourish yin and moisten the lungs",
        "Clear heat and moisten dryness",
        "Nourish yin and generate fluids"
      ],
      "guaOrgan": "肺",
      "termOrgan": "肺"
    },
    "金-水": {
      "type": "我生",
      "typeEn": "Generating",
      "title": "Metal-Water Generation",
      "sub": "Metal generates Water; lung Metal supports kidney Water. Drain Metal to nourish Water.",
      "warning": "The hexagram Metal generates the seasonal Water, so Metal is drained by Water. Lung Metal drains into kidney Water, easily leading to insufficient lung qi and excess kidney Water.",
      "principle": "Drain Metal to nourish Water, supplement the lungs and boost qi, and let Metal and Water generate each other.",
      "strategy": [
        "Supplement the lungs and boost qi",
        "Metal-Water mutual generation",
        "Nourish yin and tonify the kidneys"
      ],
      "guaOrgan": "肺",
      "termOrgan": "肾"
    },
    "水-木": {
      "type": "我生",
      "typeEn": "Generating",
      "title": "Water-Wood Generation",
      "sub": "Water generates Wood; kidney Water supports liver Wood. Drain Water to nourish Wood.",
      "warning": "The hexagram Water generates the seasonal Wood, so Water is drained by Wood. Kidney Water drains into liver Wood, easily leading to insufficient kidney essence and hyperactive liver Wood.",
      "principle": "Drain Water to nourish Wood, tonify the kidneys and benefit essence, enrich Water to nourish Wood.",
      "strategy": [
        "Nourish kidney essence",
        "Enrich Water to nourish Wood",
        "Nourish blood and soften the liver"
      ],
      "guaOrgan": "肾",
      "termOrgan": "肝"
    },
    "水-火": {
      "type": "我克",
      "typeEn": "Overcoming",
      "title": "Water-Fire Restraint",
      "sub": "Water restrains Fire; kidney Water restrains heart Fire. Protect the heart from restraint.",
      "warning": "The hexagram Water restrains the seasonal Fire, so Water is strong and restrains Fire. Cold kidney Water attacks heart Fire, easily leading to deficient heart yang, cold limbs, and a pale complexion.",
      "principle": "Restrain Fire and protect the heart, warm yang and transform qi, and communicate between heart and kidney.",
      "strategy": [
        "Warm and unblock heart yang",
        "Communicate between heart and kidney",
        "Warm yang and dispel cold"
      ],
      "guaOrgan": "肾",
      "termOrgan": "心"
    },
    "水-土": {
      "type": "克我",
      "typeEn": "Controlling",
      "title": "Earth-Water Restraint",
      "sub": "Earth restrains Water; spleen Earth restrains kidney Water. Protect the kidneys from restraint.",
      "warning": "The seasonal Earth restrains the hexagram Water, so Earth is strong and restrains Water. Spleen Earth attacks kidney Water, easily leading to insufficient kidney Water, soreness and weakness of the lower back and knees, and edema with scanty urine.",
      "principle": "Protect the kidneys from restraint, warm yang and promote water metabolism, and strengthen Earth to control Water.",
      "strategy": [
        "Warm the kidneys and promote diuresis",
        "Strengthen the spleen and drain dampness",
        "Warm yang and transform qi"
      ],
      "guaOrgan": "肾",
      "termOrgan": "脾"
    },
    "水-金": {
      "type": "生我",
      "typeEn": "Receiving",
      "title": "Metal-Water Generation",
      "sub": "Metal generates Water; lung Metal nourishes kidney Water. Supplement the mother to benefit the child.",
      "warning": "The seasonal Metal generates the hexagram Water, receiving the mother qi's nourishment. Kidney Water is nourished by lung Metal, so the original qi is supplemented. However, guard against Metal cold and Water coldness.",
      "principle": "Supplement the mother and benefit the child, let Metal and Water generate each other, and warm yang to transform qi.",
      "strategy": [
        "Metal-Water mutual generation",
        "Nourish yin and tonify the kidneys",
        "Warm yang and boost qi"
      ],
      "guaOrgan": "肾",
      "termOrgan": "肺"
    },
    "水-水": {
      "type": "同气",
      "typeEn": "Same Element",
      "title": "Double Water",
      "sub": "Like qi seeks like; kidney Water is prone to cold. Guard against cold congealing.",
      "warning": "The hexagram element is Water, and the season is also Water. Double Water makes kidney Water predominant. Guard against cold-dampness trapping the kidneys, cold pain in the lower back and knees, and clear copious urine.",
      "principle": "Warm the kidneys and transform dampness, warm yang and promote water metabolism, and prevent cold congealing and qi stagnation.",
      "strategy": [
        "Warm the kidneys and assist yang",
        "Transform qi and move water",
        "Warm yang and dispel cold"
      ],
      "guaOrgan": "肾",
      "termOrgan": "肾"
    }
  },
  "WUXING_SHENG": {
    "木": "火",
    "火": "土",
    "土": "金",
    "金": "水",
    "水": "木"
  },
  "WUXING_KE": {
    "木": "土",
    "土": "水",
    "水": "火",
    "火": "金",
    "金": "木"
  }
};
