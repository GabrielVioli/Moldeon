const hip = ["hip-front"];
const waist = ["waist-front"];
const bust = ["torso-front"];
const armLeft = ["arm-left"];
const armRight = ["arm-right"];
const twoHip = ["hip-front", "hip-back"];
const twoTorso = ["torso-front", "torso-back"];
const fourHip = ["hip-front", "hip-right", "hip-back", "hip-left"];
const fourTorso = ["torso-front", "shoulder-right", "torso-back", "shoulder-left"];
const defaults = {
  quick: false,
  panelCount: 1,
  targetPanelCount: 1,
  seamKind: "self",
  expectation: "closed-volume",
  anchors: hip,
  shapes: ["rectangle"],
  circumferenceFraction: 0.84,
  heightFraction: 0.24,
  maximumResidualMm: 5,
  minimumSecondarySpanM: 0.05,
  asymmetric: false,
  sameDirection: false,
};
const make = ([id, coverage, options = {}]) => ({ ...defaults, id, coverage, ...options });

const specs = [
  ["01-hip-self-standard", "Tubo simples de um painel, folga normal e anchor frontal do quadril.", { quick: true }],
  ["02-hip-self-tight", "Tubo simples justo no quadril preserva métrica sem shrink-to-fit.", { circumferenceFraction: 0.81 }],
  ["03-hip-self-wide", "Tubo simples largo mantém folga positiva ao redor do quadril.", { circumferenceFraction: 0.91 }],
  ["04-hip-self-extreme-wide", "Folga positiva extrema no quadril continua volumétrica sem recenter.", { circumferenceFraction: 0.96, heightFraction: 0.18 }],
  ["05-hip-self-very-small", "Tubo muito pequeno ainda fecha topologicamente e deixa fit/colisão para Provar.", { quick: true, circumferenceFraction: 0.34, minimumSecondarySpanM: 0.02 }],
  ["06-waist-self-standard", "Tubo simples na cintura usa a seção corporal correta.", { quick: true, anchors: waist, circumferenceFraction: 0.67, heightFraction: 0.16 }],
  ["07-waist-self-tight", "Cós justo preserva perímetro material no anchor de cintura.", { anchors: waist, circumferenceFraction: 0.64, heightFraction: 0.11 }],
  ["08-waist-self-wide-trapezoid", "Cós trapezoidal largo forma volume sem autoscale.", { anchors: waist, shapes: ["trapezoid"], circumferenceFraction: 0.76, heightFraction: 0.14 }],
  ["09-waist-self-extreme-wide", "Cós com folga extrema mantém volume e proximidade da cintura.", { anchors: waist, circumferenceFraction: 0.91, heightFraction: 0.10 }],
  ["10-waist-self-very-small", "Cós muito pequeno fecha sem preflight de circunferência corporal.", { anchors: waist, circumferenceFraction: 0.24, heightFraction: 0.10, minimumSecondarySpanM: 0.02 }],
  ["11-bust-self-standard", "Tubo de busto com um painel envolve a seção sem shrink-to-fit.", { quick: true, anchors: bust, circumferenceFraction: 0.79, heightFraction: 0.22 }],
  ["12-bust-self-tight", "Tubo justo no busto conserva material e fecha a seam vertical.", { anchors: bust, circumferenceFraction: 0.76, heightFraction: 0.18 }],
  ["13-bust-self-wide-asymmetric", "Painel assimétrico largo no busto conserva geometria e cria volume.", { anchors: bust, shapes: ["asymmetric"], circumferenceFraction: 0.91, asymmetric: true }],
  ["14-bust-self-tapered", "Painel afunilado testa eixo material não retangular no busto.", { anchors: bust, shapes: ["tapered"], circumferenceFraction: 0.86, heightFraction: 0.28, asymmetric: true }],
  ["15-bust-self-very-small", "Painel menor que o busto fecha a seam sem shrink-to-fit oculto.", { anchors: bust, circumferenceFraction: 0.30, minimumSecondarySpanM: 0.02 }],
  ["16-torso-self-tall", "Painel alto de torso completo preserva eixo vertical e volume.", { quick: true, anchors: bust, circumferenceFraction: 0.86, heightFraction: 0.48 }],
  ["17-torso-self-cropped", "Painel curto de torso fecha sem trocar de hemisfério corporal.", { anchors: bust, circumferenceFraction: 0.84, heightFraction: 0.12 }],
  ["18-torso-self-wide-trapezoid", "Torso trapezoidal com grande folga mantém forma técnica.", { anchors: bust, shapes: ["trapezoid"], circumferenceFraction: 0.94, heightFraction: 0.42 }],
  ["19-sleeve-left-self", "Manga tubular de um painel nasce e fecha no braço esquerdo.", { quick: true, anchors: armLeft, shapes: ["tapered"], circumferenceFraction: 0.34, heightFraction: 0.34, asymmetric: true }],
  ["20-sleeve-right-self-wide", "Manga larga preserva folga no braço direito.", { anchors: armRight, shapes: ["trapezoid"], circumferenceFraction: 0.42, heightFraction: 0.38 }],
  ["21-sleeve-left-self-narrow", "Manga estreita válida testa limite justo do braço esquerdo.", { anchors: armLeft, circumferenceFraction: 0.30, heightFraction: 0.30 }],
  ["22-sleeve-self-very-small", "Manga muito pequena fecha topologicamente sem ser ajustada ao braço.", { anchors: armLeft, circumferenceFraction: 0.10, heightFraction: 0.28, minimumSecondarySpanM: 0.02 }],
  ["23-two-hip-standard", "Dois painéis frente/costas fecham duas seams laterais ao redor do quadril.", { quick: true, panelCount: 2, targetPanelCount: 2, seamKind: "cycle", anchors: twoHip, circumferenceFraction: 0.85 }],
  ["24-two-hip-wide", "Dois painéis largos preservam folga conjunta no quadril.", { panelCount: 2, targetPanelCount: 2, seamKind: "cycle", anchors: twoHip, circumferenceFraction: 0.94 }],
  ["25-two-hip-asymmetric-width", "Frente e costas com larguras diferentes fecham como um componente.", { panelCount: 2, targetPanelCount: 2, seamKind: "cycle", anchors: twoHip, circumferenceFraction: 0.88, asymmetric: true }],
  ["26-two-hip-mixed-shapes", "Painel retangular e trapezoidal preservam topologias distintas no tubo.", { panelCount: 2, targetPanelCount: 2, seamKind: "cycle", anchors: twoHip, shapes: ["rectangle", "trapezoid"], circumferenceFraction: 0.90, asymmetric: true }],
  ["27-two-waist-standard", "Dois painéis formam um cós fechado na cintura.", { panelCount: 2, targetPanelCount: 2, seamKind: "cycle", anchors: ["waist-front", "waist-back"], circumferenceFraction: 0.69, heightFraction: 0.12 }],
  ["28-two-waist-wide", "Cós bipainel largo mantém folga em vez de encolher.", { panelCount: 2, targetPanelCount: 2, seamKind: "cycle", anchors: ["waist-front", "waist-back"], circumferenceFraction: 0.80, heightFraction: 0.13 }],
  ["29-two-bust-standard", "Frente e costas do busto fecham ambas as laterais.", { panelCount: 2, targetPanelCount: 2, seamKind: "cycle", anchors: twoTorso, circumferenceFraction: 0.81 }],
  ["30-two-bust-tall", "Corpo alto de dois painéis mantém volume por toda a altura.", { panelCount: 2, targetPanelCount: 2, seamKind: "cycle", anchors: twoTorso, circumferenceFraction: 0.87, heightFraction: 0.46 }],
  ["31-two-sleeve-left", "Manga de duas metades fecha duas seams no braço esquerdo.", { panelCount: 2, targetPanelCount: 2, seamKind: "cycle", anchors: armLeft, shapes: ["tapered", "trapezoid"], circumferenceFraction: 0.36, heightFraction: 0.34, asymmetric: true }],
  ["32-two-sleeve-right", "Manga bipainel assimétrica fecha no braço direito.", { panelCount: 2, targetPanelCount: 2, seamKind: "cycle", anchors: armRight, shapes: ["asymmetric", "tapered"], circumferenceFraction: 0.39, heightFraction: 0.31, asymmetric: true }],
  ["33-two-front-opening", "Abertura frontal de dois painéis fecha só a seam traseira e mantém concha aberta.", { panelCount: 2, targetPanelCount: 2, seamKind: "chain", anchors: twoTorso, circumferenceFraction: 0.88, heightFraction: 0.35, expectation: "open-shell", minimumSecondarySpanM: 0.02 }],
  ["34-two-front-opening-asymmetric", "Abertura frontal assimétrica conserva diferença entre as metades.", { panelCount: 2, targetPanelCount: 2, seamKind: "chain", anchors: twoTorso, shapes: ["trapezoid", "asymmetric"], circumferenceFraction: 0.92, heightFraction: 0.30, expectation: "open-shell", minimumSecondarySpanM: 0.02, asymmetric: true }],
  ["35-four-hip-cardinal", "Quatro painéis nos anchors cardinais fecham quatro seams no quadril.", { quick: true, panelCount: 4, targetPanelCount: 4, seamKind: "cycle", anchors: fourHip, circumferenceFraction: 0.87 }],
  ["36-four-hip-wide", "Tubo quadripainel largo preserva folga distribuída.", { panelCount: 4, targetPanelCount: 4, seamKind: "cycle", anchors: fourHip, circumferenceFraction: 0.95 }],
  ["37-four-hip-asymmetric", "Quatro larguras assimétricas mantêm identidade física no ciclo.", { panelCount: 4, targetPanelCount: 4, seamKind: "cycle", anchors: fourHip, circumferenceFraction: 0.91, asymmetric: true }],
  ["38-four-hip-mixed", "Quatro topologias mistas fecham todas as seams simultaneamente.", { panelCount: 4, targetPanelCount: 4, seamKind: "cycle", anchors: fourHip, shapes: ["rectangle", "trapezoid", "tapered", "asymmetric"], circumferenceFraction: 0.91, asymmetric: true }],
  ["39-four-waist", "Cós de quatro painéis fecha no nível da cintura.", { panelCount: 4, targetPanelCount: 4, seamKind: "cycle", anchors: ["waist-front", "waist-back"], circumferenceFraction: 0.71, heightFraction: 0.11 }],
  ["40-four-bust", "Quatro painéis formam volume de busto sem autoscale.", { panelCount: 4, targetPanelCount: 4, seamKind: "cycle", anchors: fourTorso, circumferenceFraction: 0.84 }],
  ["41-four-torso-tall", "Quatro painéis altos cobrem torso mantendo fechamento e placement.", { panelCount: 4, targetPanelCount: 4, seamKind: "cycle", anchors: fourTorso, circumferenceFraction: 0.89, heightFraction: 0.46 }],
  ["42-four-same-direction", "Primeira seam em mesmo sentido permanece canônica no fechamento.", { panelCount: 4, targetPanelCount: 4, seamKind: "cycle", anchors: fourHip, circumferenceFraction: 0.89, sameDirection: true }],
  ["43-eight-hip-octagonal", "Oito painéis formam ciclo octagonal no quadril.", { quick: true, panelCount: 8, targetPanelCount: 8, seamKind: "cycle", anchors: fourHip, circumferenceFraction: 0.90, heightFraction: 0.22 }],
  ["44-eight-hip-wide", "Oito painéis largos preservam folga total distribuída.", { panelCount: 8, targetPanelCount: 8, seamKind: "cycle", anchors: fourHip, circumferenceFraction: 0.97, heightFraction: 0.20 }],
  ["45-eight-waist", "Oito painéis estreitos fecham um cós complexo.", { panelCount: 8, targetPanelCount: 8, seamKind: "cycle", anchors: ["waist-front", "waist-back"], circumferenceFraction: 0.73, heightFraction: 0.10 }],
  ["46-eight-bust", "Oito painéis fecham simultaneamente na região do busto.", { panelCount: 8, targetPanelCount: 8, seamKind: "cycle", anchors: fourTorso, circumferenceFraction: 0.86 }],
  ["47-eight-torso-tall", "Oito painéis altos testam volume contínuo de torso completo.", { panelCount: 8, targetPanelCount: 8, seamKind: "cycle", anchors: fourTorso, circumferenceFraction: 0.91, heightFraction: 0.42 }],
  ["48-eight-asymmetric-mixed", "Oito painéis assimétricos e mistos preservam cada geometria.", { panelCount: 8, targetPanelCount: 8, seamKind: "cycle", anchors: fourHip, shapes: ["rectangle", "trapezoid", "tapered", "asymmetric"], circumferenceFraction: 0.93, heightFraction: 0.23, asymmetric: true }],
  ["49-three-asymmetric-cycle", "Número ímpar assimétrico: três painéis fecham ciclo sem inferência por nome.", { panelCount: 3, targetPanelCount: 3, seamKind: "cycle", anchors: ["hip-front", "hip-back", "hip-left"], shapes: ["trapezoid", "rectangle", "asymmetric"], circumferenceFraction: 0.89, asymmetric: true }],
  ["50-five-asymmetric-cycle", "Cinco painéis de larguras distintas fecham um ciclo único.", { panelCount: 5, targetPanelCount: 5, seamKind: "cycle", anchors: fourHip, shapes: ["rectangle", "trapezoid", "asymmetric"], circumferenceFraction: 0.91, asymmetric: true }],
  ["51-three-front-opening", "Três painéis em cadeia preservam abertura frontal e fecham duas seams.", { panelCount: 3, targetPanelCount: 3, seamKind: "chain", anchors: ["torso-front", "torso-back", "torso-front"], circumferenceFraction: 0.90, heightFraction: 0.37, expectation: "open-shell", minimumSecondarySpanM: 0.02 }],
  ["52-five-front-opening-asymmetric", "Cinco painéis assimétricos em cadeia mantêm abertura e placement.", { panelCount: 5, targetPanelCount: 5, seamKind: "chain", anchors: fourTorso, shapes: ["trapezoid", "asymmetric", "rectangle"], circumferenceFraction: 0.94, heightFraction: 0.34, expectation: "open-shell", minimumSecondarySpanM: 0.02, asymmetric: true }],
  ["53-no-seams", "Painel confirmado sem costura não recebe fechamento inventado.", { quick: true, seamKind: "none", expectation: "no-seams", minimumSecondarySpanM: 0 }],
  ["54-incomplete-seam", "Seleção incompleta é cancelada pela UI e não alcança o solver.", { quick: true, seamKind: "incomplete", expectation: "no-seams", minimumSecondarySpanM: 0 }],
  ["55-disconnected-self-components", "Duas autocosturas desconectadas ajustam somente o componente selecionado.", { panelCount: 2, targetPanelCount: 1, seamKind: "disconnected-self", anchors: twoHip, circumferenceFraction: 1.65 }],
  ["56-asymmetric-same-direction", "Ciclo assimétrico preserva direção igual na primeira seam.", { panelCount: 3, targetPanelCount: 3, seamKind: "cycle", anchors: ["hip-front", "hip-back", "hip-right"], shapes: ["asymmetric", "trapezoid", "rectangle"], circumferenceFraction: 0.90, asymmetric: true, sameDirection: true }],
];

export const STEP0_E2E_SCENARIOS = specs.map(make);
