/* GAME_V1_MISSIONS_BEGIN — authored, fictional classroom scenarios; no personal data. */
const ConexaMissions = (() => {
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const points = [
    { x: 10, y: 4, place: 'Mural', person: 'Mural da comunidade', kind: 'object', color: '#e97550' },
    { x: 5, y: 5, place: 'Escola', person: 'Lia · oficina de mídia', kind: 'npc', color: '#4c88b6' },
    { x: 6, y: 10, place: 'Praça', person: 'Caio · coletivo da praça', kind: 'npc', color: '#bd785c' },
    { x: 12, y: 6, place: 'Arquivo', person: 'Nara · memória da cidade', kind: 'npc', color: '#8276b8' }
  ];
  return freeze([
    {
      id: 0, number: '01', title: 'Identidade e realidade', short: 'Além da vitrine',
      question: 'Uma publicação mostra uma pessoa inteira?',
      brief: 'Ravi publicou uma foto de uma conquista. Investigue o que aparece na vitrine e o que ficou fora do enquadramento antes de responder à publicação.',
      release: 'Nara recebeu o registro completo da apresentação. O arquivo agora pode ser consultado.',
      teacher: 'Peça que distingam o que a foto permite afirmar do que foi imaginado a partir dela. Uma conquista pode ser verdadeira e a representação ainda ser parcial. Libere o arquivo depois de uma primeira visita ao mural, à escola e à praça.',
      clues: [
        { ...points[0], title: 'A publicação recortada', source: 'Publicação de Ravi',
          dialogue: '“Mais um prêmio. Parece fácil quando a gente nasceu para isso.” A imagem mostra Ravi sozinho com um troféu. O enquadramento não mostra o restante do palco. É uma publicação fictícia desta história.',
          evidence: 'A foto publicada mostra apenas Ravi e o troféu. Não mostra a equipe, os ensaios nem a data do evento.',
          prompt: 'Observe o que a publicação mostra e quais informações ela não fornece.' },
        { ...points[1], title: 'Os créditos da apresentação', source: 'Ficha da oficina',
          dialogue: 'Lia abre a ficha da oficina: “O projeto reuniu Ravi, Bia e Tom. Ravi apresentou; Bia produziu o vídeo; Tom pesquisou. Os três aparecem nos créditos. A foto não conta esse trabalho coletivo.”',
          evidence: 'A ficha de produção credita Ravi, Bia e Tom, com tarefas diferentes no mesmo projeto.',
          prompt: 'Quem contribuiu para a conquista que apareceu como individual?' },
        { ...points[2], title: 'O caminho até o palco', source: 'Diário de ensaios',
          dialogue: 'Caio mostra o diário autorizado da equipe: “Foram seis ensaios. Na primeira tentativa o vídeo não abriu; na terceira, o tempo acabou. O resultado veio depois de ajustes, ajuda e prática.”',
          evidence: 'O diário registra seis ensaios, duas dificuldades e as correções feitas pela equipe antes da apresentação.',
          prompt: 'Que parte do processo ficou invisível na legenda?' },
        { ...points[3], title: 'O registro completo', source: 'Arquivo do evento',
          dialogue: 'Nara apresenta o registro integral: “A apresentação aconteceu no mês anterior à postagem. A foto aberta mostra os três integrantes juntos. O prêmio é real dentro da história; a legenda omitiu o contexto.”',
          evidence: 'O registro integral identifica a apresentação no mês anterior à postagem e mostra os três integrantes no palco.',
          prompt: 'A data da postagem e a data do acontecimento são a mesma coisa?', locked: true }
      ],
      claims: [
        'A conquista teve contribuição de mais de uma pessoa.',
        'Houve dificuldades e preparação antes do resultado.',
        'O recorte da postagem omite informações sobre o processo.',
        'O acontecimento foi anterior à publicação e há um registro mais amplo.'
      ],
      links: [1, 2, 0, 3],
      facts: 'A conquista existiu, foi coletiva e exigiu preparação. A publicação destacou uma pessoa e um momento; ela não descreve toda a identidade nem toda a experiência de Ravi.',
      decisions: [
        { label: 'Publicar um comentário com contexto', action: 'Reconhecer a conquista, citar o trabalho coletivo e indicar o registro completo.', consequence: 'O mural passa a exibir uma nota de contexto junto da publicação, com crédito à equipe.' },
        { label: 'Propor uma publicação de bastidores', action: 'Convidar a equipe a mostrar tentativas, colaboração e aprendizado.', consequence: 'A escola abre uma mostra de bastidores: processo, colaboração e resultado aparecem juntos.' },
        { label: 'Conversar antes de compartilhar', action: 'Perguntar à equipe sobre o recorte e compartilhar apenas a versão contextualizada.', consequence: 'A praça recebe um ponto de conversa: verificar o contexto passa a preceder o compartilhamento.' }
      ]
    },
    {
      id: 1, number: '02', title: 'Reputação digital', short: 'Quem pode participar?',
      question: 'Um número de curtidas deve decidir quem tem acesso?',
      brief: 'Uma regra experimental do mural reserva os melhores horários do estúdio aos perfis mais curtidos. Investigue as consequências para personagens fictícios e proponha uma regra de participação.',
      release: 'Chegou o relatório da semana do estúdio. Nara pode mostrar quem teve acesso e quais projetos ficaram de fora.',
      teacher: 'A popularidade é de personagens fictícios. Não peça avaliações, rankings ou comparações entre os alunos reais. Discuta critérios de acesso, efeitos não previstos e como revisar uma regra com evidências.',
      clues: [
        { ...points[0], title: 'A regra do mural', source: 'Regulamento experimental',
          dialogue: 'O mural anuncia: “Os três perfis com mais curtidas escolhem primeiro os horários do estúdio. Os demais recebem as vagas restantes.” O sistema conta curtidas, sem avaliar necessidade ou contribuição.',
          evidence: 'O regulamento experimental usa quantidade de curtidas como primeiro critério para escolher horários do estúdio.',
          prompt: 'O que essa regra mede? O que ela deixa de considerar?' },
        { ...points[1], title: 'O acordo da comunidade', source: 'Acordo do estúdio',
          dialogue: 'Lia mostra o acordo original: “O estúdio pertence à comunidade. Cada grupo deve ter oportunidade de produzir e aprender. Este acordo foi aprovado antes da regra experimental; não prometia privilégio por fama.”',
          evidence: 'O acordo do estúdio garante oportunidade de participação aos grupos e não condiciona o acesso à popularidade.',
          prompt: 'Qual compromisso deve orientar uma regra de acesso?' },
        { ...points[2], title: 'O projeto que não entrou', source: 'Registro do atendimento',
          dialogue: 'Caio relata o caso fictício de Jo: “O perfil era novo e tinha poucas curtidas. O pedido para gravar um tutorial acessível foi recusado porque os horários já tinham sido escolhidos pelos mesmos perfis. O atendimento registrou esse motivo.”',
          evidence: 'O atendimento de Jo registra falta de horário após a escolha dos perfis mais curtidos; o mérito do projeto não foi analisado.',
          prompt: 'A recusa revela falta de qualidade ou um efeito da regra?' },
        { ...points[3], title: 'Uma semana de consequências', source: 'Relatório de acesso',
          dialogue: 'Nara compara as reservas: “Os mesmos três perfis ficaram com todos os horários mais procurados. Dois grupos novos desistiram. A regra ampliou a vantagem de quem já era conhecido; isso não prova que os outros projetos fossem piores.”',
          evidence: 'O relatório registra concentração dos horários em três perfis e desistência de dois grupos novos durante a experiência.',
          prompt: 'Que consequência aparece quando se observa o conjunto, além de um caso?', locked: true }
      ],
      claims: [
        'Um projeto ficou sem horário por efeito da prioridade dada aos perfis populares.',
        'A regra usa curtidas como critério de acesso, sem medir a qualidade do projeto.',
        'A experiência concentrou oportunidades e afastou grupos novos.',
        'Uma regra de participação deve respeitar o acordo de oportunidade para os grupos.'
      ],
      links: [2, 0, 3, 1],
      facts: 'Curtidas não medem o valor de uma pessoa nem, sozinhas, a qualidade de um projeto. A regra experimental concentrou acesso. A comunidade pode mudar a regra sem transformar seus integrantes em um ranking.',
      decisions: [
        { label: 'Criar um rodízio transparente', action: 'Garantir uma primeira oportunidade a cada grupo e publicar a ordem de uso.', consequence: 'O estúdio troca a fila por curtidas por um rodízio visível de oportunidades.' },
        { label: 'Reservar acesso para novos projetos', action: 'Separar horários para quem ainda não participou e revisar o resultado com a comunidade.', consequence: 'A escola sinaliza horários de acolhimento para projetos que ainda não tiveram acesso.' },
        { label: 'Abrir uma agenda por necessidade', action: 'Combinar critérios públicos de prazo e acessibilidade, com revisão e possibilidade de contestação.', consequence: 'A praça abre um conselho de revisão: a agenda passa a explicar os critérios e aceitar pedidos de revisão.' }
      ]
    },
    {
      id: 2, number: '03', title: 'Desinformação', short: 'Antes de repassar',
      question: 'O que precisamos verificar antes de agir sobre uma notícia?',
      brief: 'Circula uma mensagem dizendo que a escola ficará fechada amanhã por água contaminada. Reconstrua a origem, confira a data e compare a imagem com o aviso completo antes de orientar a comunidade.',
      release: 'O arquivo de datas foi localizado. Nara pode comparar o aviso antigo com a programação atual da escola.',
      teacher: 'O roteiro trata de uma notícia fictícia. Diferencie “não encontrei prova” de “provei que é falso”. Neste caso há documentos que identificam o aviso antigo e a foto de outro local. A votação sobre como agir nunca altera esses fatos.',
      clues: [
        { ...points[0], title: 'A mensagem que circulou', source: 'Mensagem encaminhada',
          dialogue: 'No mural: “ESCOLA FECHADA AMANHÃ! Água contaminada. Repasse!” A mensagem contém uma foto de uma torneira com água escura e um recorte sem data nem endereço. Não há assinatura ou link para um aviso completo.',
          evidence: 'A mensagem encaminhada não identifica autor, data ou endereço; junta uma chamada urgente a uma imagem sem contexto.',
          prompt: 'Quais informações essenciais desapareceram no encaminhamento?' },
        { ...points[1], title: 'Quem publicou o aviso?', source: 'Aviso integral da escola',
          dialogue: 'Lia apresenta o aviso integral do arquivo escolar: “Este comunicado foi emitido pela secretaria para uma manutenção programada de duas horas, em uma data anterior. Não anunciava contaminação nem fechamento no dia seguinte à mensagem atual.”',
          evidence: 'O aviso integral identifica a secretaria como origem e descreve uma manutenção programada de duas horas, sem anúncio de contaminação.',
          prompt: 'Compare a afirmação original com a versão que foi encaminhada.' },
        { ...points[2], title: 'O que a imagem documenta?', source: 'Ficha original da fotografia',
          dialogue: 'Caio abre a ficha da imagem: “A foto pertence a uma demonstração com pigmento numa oficina do centro comunitário. A legenda e a sequência completa identificam o experimento e o local. Ela não registra a água da escola.”',
          evidence: 'A ficha e a sequência original situam a foto em uma oficina com pigmento no centro comunitário, e não na escola.',
          prompt: 'Uma imagem verdadeira pode sustentar uma legenda enganosa?' },
        { ...points[3], title: 'As datas em ordem', source: 'Arquivo e agenda atual',
          dialogue: 'Nara alinha os documentos: “O aviso de manutenção é do semestre anterior. A agenda atual mantém as atividades de amanhã. A data foi cortada do encaminhamento; um aviso antigo ganhou aparência de urgência atual.”',
          evidence: 'O arquivo data a manutenção no semestre anterior; a agenda atual mantém as atividades do dia seguinte à mensagem.',
          prompt: 'A que momento cada documento se refere?', locked: true }
      ],
      claims: [
        'A origem identificada descreve uma manutenção, sem anunciar contaminação.',
        'O aviso é antigo e não corresponde à agenda atual.',
        'O encaminhamento omite dados necessários e mistura uma imagem sem contexto.',
        'A imagem documenta uma oficina em outro local, não a água da escola.'
      ],
      links: [1, 3, 0, 2],
      facts: 'A mensagem reuniu um aviso antigo, uma imagem de outro local e uma conclusão que os documentos não sustentam. Os registros desta história não anunciam contaminação nem o fechamento atual da escola.',
      decisions: [
        { label: 'Corrigir com fontes e contexto', action: 'Publicar uma correção respeitosa que apresente origem, data e a ficha da imagem.', consequence: 'O mural recebe uma correção com fontes e contexto ao lado da mensagem original.' },
        { label: 'Interromper o repasse e orientar', action: 'Parar a circulação da mensagem e explicar à comunidade como conferir o aviso completo.', consequence: 'A praça ganha um ponto de verificação: origem, data, contexto e evidências passam a acompanhar os avisos.' },
        { label: 'Pedir uma atualização à origem', action: 'Solicitar um aviso atual à secretaria, anexando a verificação já realizada, sem repetir a acusação como fato.', consequence: 'A escola publica um aviso atualizado com data, autoria e referência aos documentos consultados.' }
      ]
    }
  ]);
})();
/* GAME_V1_MISSIONS_END */

/* UI consumes confirmed snapshots only. Network, authentication and rules belong to the host. */
function createGameV1UI({ view, send, navigate, onSound = () => {} }) {
  const teacher = view === 'teacher';
  const projector = view === 'projector';
  let world = null, status = {}, selectedMission = 0, activeClue = null;
  let sessionKey = '', lastKey = '', pending = false, muted = true, originFocus = null;
  let confirmAction = null, confirmFingerprint = null;
  const drafts = ConexaMissions.map(() => ({ links: ['', '', '', ''], decision: '' }));
  const roots = [];
  const phaseNames = { lobby: 'Aguardando início', open: 'Exploração liberada', paused: 'Experiência pausada', closed: 'Experiência encerrada' };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const button = (label, action, className = 'v1-button') => {
    const node = el('button', className, label); node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
  };
  const append = (parent, ...nodes) => { nodes.forEach(node => parent.append(node)); return parent; };
  const countBits = mask => [0, 1, 2, 3].filter(i => (mask || 0) & (1 << i)).length;
  const mission = () => ConexaMissions[selectedMission];
  const own = () => world && world.me && world.me.joined !== false && status.authenticated ? world.me : null;
  const mask = (id = selectedMission) => own() ? Number(own().clues[id]) || 0 : 0;
  const done = (id = selectedMission) => Boolean(own() && (own().done & (1 << id)));
  const released = (id = selectedMission) => Boolean(world && (world.released & (1 << id)));
  const joined = () => world && typeof world.positions === 'string' ? (world.positions.match(/.{2}/g) || []).filter(p => p !== '--').length : 0;
  const ready = () => Boolean(world && status.online && !status.busy && !pending);
  const canPlay = () => Boolean(ready() && own() && world.phase === 'open' && selectedMission <= world.mission && !done());
  const at = point => {
    const position = status.position || own();
    return Boolean(position && Number.isInteger(position.x) && Number.isInteger(position.y) && Math.abs(position.x - point.x) + Math.abs(position.y - point.y) <= 1);
  };
  const notices = [];
  function makeNotice() {
    const node = el('p', 'v1-notice'); node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
    notices.push(node); return node;
  }
  const notice = makeNotice();
  function signal(name) { if (!muted) onSound(name); }
  function report(text) { notices.forEach(node => { node.textContent = text; }); }
  function issue(op, arg) {
    if (!ready()) return false;
    const accepted = send(op, arg);
    if (accepted !== false) {
      pending = true;
      report('Solicitação enviada. Aguardando confirmação da cidade.');
      renderAll();
      signal('action');
      return true;
    }
    report('A ação não pôde ser enviada agora. Confira a conexão e tente novamente.');
    return false;
  }
  function modalEvent() {
    document.dispatchEvent(new CustomEvent('conexa-v1-modal', { detail: { open: roots.some(n => n.tagName === 'DIALOG' && n.isConnected && n.open) } }));
  }
  function dialog(id, label) {
    const node = el('dialog', 'v1-dialog'); node.id = id; node.setAttribute('aria-label', label);
    const close = button('Fechar', () => node.close(), 'v1-close'); close.setAttribute('aria-label', 'Fechar ' + label.toLowerCase());
    append(node, close); document.body.append(node); roots.push(node);
    node.addEventListener('close', () => {
      modalEvent();
      if (!roots.some(n => n.tagName === 'DIALOG' && n.open)) {
        const target = originFocus && originFocus.isConnected && originFocus.getClientRects().length ? originFocus : document.getElementById('iso-world');
        if (target) target.focus({ preventScroll: true });
      }
    });
    return node;
  }
  function open(node) {
    originFocus = document.activeElement;
    roots.filter(n => n.tagName === 'DIALOG' && n.open && n !== node).forEach(n => n.close());
    if (!node.open) node.showModal();
    modalEvent();
  }
  function leaveFor(point) {
    roots.filter(n => n.tagName === 'DIALOG' && n.open).forEach(n => n.close());
    navigate(point.x, point.y);
  }
  const journal = dialog('v1-journal', 'Diário de investigação');
  const journalBody = el('div', 'v1-journal-body'); append(journal, journalBody, notice);
  const conversation = dialog('v1-conversation', 'Conversa e evidência');
  const conversationBody = el('div'); append(conversation, conversationBody, makeNotice());
  const summary = dialog('v1-summary', 'Acontecimentos da cidade');
  const summaryBody = el('div', 'v1-summary-body'); append(summary, summaryBody, makeNotice());
  const confirmation = dialog('v1-confirmation', 'Confirmar controle da experiência');
  const confirmText = el('p', 'v1-confirm-text');
  const confirmButtons = el('div', 'v1-actions');
  append(confirmButtons, button('Cancelar', () => confirmation.close()), button('Confirmar', () => {
    if (!confirmAction || !confirmFingerprint || confirmFingerprint !== controlFingerprint() || !ready()) {
      cancelConfirmation('O estado da sessão mudou. Revise a cidade e solicite a ação novamente.');
      return;
    }
    const action = confirmAction; confirmAction = null; confirmFingerprint = null; confirmation.close(); issue(action, 0);
  }, 'v1-button v1-primary'));
  append(confirmation, el('h2', '', 'Confirmar ação'), confirmText, confirmButtons);
  confirmation.addEventListener('close', () => { if (!confirmation.open) { confirmAction = null; confirmFingerprint = null; } });
  function controlFingerprint() { return world && world.teacher ? JSON.stringify([world.boot, world.epoch, world.teacher.seq]) : null; }
  function cancelConfirmation(message) {
    confirmAction = null; confirmFingerprint = null;
    if (confirmation.open) confirmation.close();
    if (message) report(message);
  }
  function ask(op, text) {
    if (!world || !world.teacher || !ready()) return;
    confirmAction = op; confirmFingerprint = controlFingerprint(); confirmText.textContent = text; open(confirmation);
  }
  const journalButton = button(projector ? 'Acontecimentos' : 'Diário de missões', () => projector ? openSummary() : openJournal(), 'v1-menu-button');
  journalButton.id = 'v1-journal-button';
  const journalHost = document.getElementById(projector ? 'projector-controls' : 'view-menu') || document.querySelector('.game') || document.body;
  if (projector) journalHost.append(journalButton); else journalHost.prepend(journalButton);
  roots.push(journalButton);
  const teacherPanel = el('section', 'v1-teacher-panel'); teacherPanel.id = 'v1-teacher-panel'; teacherPanel.setAttribute('aria-label', 'Controle do jogo completo');
  const teacherFeedback = makeNotice();
  if (teacher) { (document.getElementById('teacher-panel') || document.body).prepend(teacherPanel); roots.push(teacherPanel); }

  function heading(parent, eyebrow, title, description) {
    append(parent, el('p', 'v1-eyebrow', eyebrow), el('h2', '', title));
    if (description) parent.append(el('p', 'v1-lead', description));
  }
  function availability() {
    if (!world) return 'Aguardando o estado da cidade.';
    if (!status.online) return 'Conexão interrompida. As pistas confirmadas continuam no diário; ações aguardam reconexão.';
    if (!own()) return 'Entre com seu código pelo menu para registrar pistas e concluir missões.';
    if (world.phase === 'lobby') return 'O professor ainda vai iniciar a experiência.';
    if (world.phase === 'paused') return 'O professor pausou a experiência. Você pode revisar as pistas já reunidas.';
    if (world.phase === 'closed') return 'A experiência foi encerrada. Seu diário e os resultados continuam disponíveis nesta execução.';
    if (selectedMission > world.mission) return 'Esta missão ainda não foi liberada pelo professor.';
    if (done()) return 'Missão concluída e confirmada pela cidade.';
    if (pending || status.busy) return 'Aguardando confirmação de uma ação.';
    return 'Explore, escute os personagens e registre as evidências antes de decidir.';
  }
  function preserveFocus(container, render) {
    const focused = container.contains(document.activeElement) ? document.activeElement.id : '';
    const scroll = container.closest('dialog')?.scrollTop;
    render();
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
    if (scroll !== undefined) container.closest('dialog').scrollTop = scroll;
  }
  function renderJournal() {
    preserveFocus(journalBody, () => {
      journalBody.replaceChildren();
      const item = mission();
      heading(journalBody, 'CONEXA 200 · HISTÓRIA FICTÍCIA', 'Diário de investigação', 'Uma cidade, três investigações. Seu diário acompanha as pistas reunidas e as ações realizadas.');
      const tabs = el('nav', 'v1-tabs'); tabs.setAttribute('aria-label', 'Missões');
      ConexaMissions.forEach((entry, index) => {
        const tab = button(entry.number + ' ' + entry.short + (done(index) ? ' ✓' : ''), () => {
          selectedMission = index; activeClue = null; report(''); renderAll();
        });
        tab.id = 'v1-tab-' + index; tab.disabled = !world || index > world.mission;
        tab.setAttribute('aria-current', index === selectedMission ? 'true' : 'false'); tabs.append(tab);
      });
      journalBody.append(tabs);
      heading(journalBody, 'MISSÃO ' + item.number, item.title, item.brief);
      journalBody.append(el('p', 'v1-availability', availability()));
      const objectives = el('ol', 'v1-objectives');
      append(objectives,
        el('li', countBits(mask()) === 4 ? 'v1-done' : '', 'Reunir quatro evidências: ' + countBits(mask()) + '/4.'),
        el('li', done() ? 'v1-done' : '', 'No mural, relacionar cada afirmação à fonte que a sustenta.'),
        el('li', done() ? 'v1-done' : '', 'Escolher uma ação responsável e observar sua consequência.'));
      journalBody.append(objectives);
      const cards = el('div', 'v1-clue-grid');
      item.clues.forEach((clue, index) => {
        const collected = Boolean(mask() & (1 << index));
        const card = el('article', 'v1-clue-card' + (collected ? ' v1-collected' : ''));
        append(card, el('span', 'v1-clue-state', collected ? '✓ Pista registrada' : clue.locked && !released() ? 'Aguardando acontecimento' : 'Pista a investigar'), el('h3', '', clue.title), el('p', 'v1-source', clue.person + ' · ' + clue.place));
        card.append(el('p', '', collected ? clue.evidence : 'Visite este ponto e converse para conhecer a evidência.'));
        const actions = el('div', 'v1-actions');
        const go = button('Ir até ' + clue.place, () => leaveFor(clue)); go.id = 'v1-go-' + index;
        go.disabled = !canPlay() || (clue.locked && !released());
        actions.append(go);
        if (collected) actions.append(button('Rever pista', () => interact(index), 'v1-text-button'));
        card.append(actions); cards.append(card);
      });
      journalBody.append(cards);
      if (done()) renderConsequence(journalBody, item);
      else renderBoard(journalBody, item);
      const options = el('div', 'v1-journal-options');
      const sound = button(muted ? 'Som: desligado' : 'Som: ligado', () => { muted = !muted; signal('action'); renderJournal(); }, 'v1-text-button');
      sound.id = 'v1-sound'; sound.setAttribute('aria-pressed', String(!muted));
      append(options, sound, button('Acontecimentos coletivos', openSummary, 'v1-text-button'));
      journalBody.append(options);
    });
  }
  function renderBoard(parent, item) {
    const board = el('section', 'v1-board');
    append(board, el('h3', '', 'Reconstruir a história no mural'), el('p', '', 'Ligue cada afirmação à fonte que a sustenta mais diretamente. Depois escolha como agir. As ações finais têm efeitos diferentes; os fatos são os mesmos.'));
    if (mask() !== 15) {
      board.append(el('p', 'v1-availability', 'O quadro de evidências será liberado quando as quatro pistas estiverem registradas.'));
      parent.append(board); return;
    }
    const draft = drafts[selectedMission];
    item.claims.forEach((claim, index) => {
      const field = el('label', 'v1-match-field'); field.htmlFor = 'v1-match-' + index;
      field.append(el('span', '', (index + 1) + '. ' + claim));
      const select = el('select'); select.id = 'v1-match-' + index;
      const empty = el('option', '', 'Escolha a fonte'); empty.value = ''; select.append(empty);
      item.clues.forEach((clue, sourceIndex) => { const option = el('option', '', clue.source); option.value = String(sourceIndex); select.append(option); });
      select.value = draft.links[index]; select.disabled = !canPlay();
      select.addEventListener('change', () => { draft.links[index] = select.value; updateResolveButton(); });
      field.append(select); board.append(field);
    });
    const fieldset = el('fieldset', 'v1-decisions');
    fieldset.append(el('legend', '', 'Com as evidências reunidas, como você vai agir?'));
    item.decisions.forEach((decision, index) => {
      const label = el('label', 'v1-decision');
      const input = el('input'); input.type = 'radio'; input.name = 'v1-decision'; input.value = String(index); input.id = 'v1-decision-' + index;
      input.checked = draft.decision === String(index); input.disabled = !canPlay();
      input.addEventListener('change', () => { draft.decision = input.value; updateResolveButton(); });
      const text = el('span'); append(text, el('strong', '', decision.label), el('small', '', decision.action));
      append(label, input, text); fieldset.append(label);
    });
    board.append(fieldset);
    if (!at(item.clues[0])) board.append(button('Voltar ao mural para concluir', () => leaveFor(item.clues[0]), 'v1-button'));
    const submit = button('Confirmar investigação e ação', () => {
      const links = draft.links.reduce((value, source, index) => value | (Number(source) << (index * 2)), 0);
      issue('resolve', selectedMission * 4096 + Number(draft.decision) * 256 + links);
    }, 'v1-button v1-primary'); submit.id = 'v1-resolve';
    board.append(submit); parent.append(board); updateResolveButton();
  }
  function updateResolveButton() {
    const submit = document.getElementById('v1-resolve'); if (!submit) return;
    const draft = drafts[selectedMission];
    submit.disabled = !canPlay() || mask() !== 15 || !at(mission().clues[0]) || draft.links.some(v => v === '') || draft.decision === '';
  }
  function renderConsequence(parent, item) {
    const box = el('section', 'v1-consequence');
    const selected = own() && Number(own().decisions[item.id]);
    append(box, el('h3', '', '✓ Investigação concluída'), el('p', '', item.facts));
    if (Number.isInteger(selected) && selected >= 0 && selected < item.decisions.length) {
      append(box, el('h4', '', item.decisions[selected].label), el('p', '', item.decisions[selected].consequence));
    }
    box.append(el('p', 'v1-facts-note', 'As escolhas indicam como agir. Nenhuma maioria transforma uma afirmação sem evidência em fato.'));
    parent.append(box);
  }
  function renderConversation() {
    if (activeClue === null) { conversationBody.replaceChildren(); return; }
    preserveFocus(conversationBody, () => {
      conversationBody.replaceChildren();
      const item = mission(), clue = item.clues[activeClue], collected = Boolean(mask() & (1 << activeClue));
      heading(conversationBody, 'MISSÃO ' + item.number + ' · ' + clue.place.toUpperCase(), clue.person, clue.title);
      if (clue.locked && !released() && !collected) {
        append(conversationBody, el('p', 'v1-dialogue', '“Ainda estou reunindo o documento completo. O professor vai avisar quando o arquivo chegar. Enquanto isso, investigue os outros pontos da cidade.”'), el('p', 'v1-availability', 'Aguardando liberação deste acontecimento.'));
      } else if (!at(clue) && !collected) {
        append(conversationBody, el('p', 'v1-dialogue', 'Aproxime-se deste ponto para conversar e conhecer a evidência.'), button('Caminhar até ' + clue.place, () => leaveFor(clue), 'v1-button v1-primary'));
      } else {
        append(conversationBody, el('p', 'v1-dialogue', clue.dialogue), el('p', 'v1-reflection', clue.prompt));
        if (collected) conversationBody.append(el('p', 'v1-confirmed', '✓ Evidência já registrada no seu diário.'));
        else {
          const collect = button('Registrar esta pista', () => issue('inspect', selectedMission * 8 + activeClue), 'v1-button v1-primary');
          collect.id = 'v1-collect'; collect.disabled = !canPlay() || !at(clue); conversationBody.append(collect);
        }
      }
      const actions = el('div', 'v1-actions'); append(actions, button('Abrir diário', openJournal), button('Voltar à cidade', () => conversation.close()));
      conversationBody.append(actions);
      if (!canPlay() && !done()) conversationBody.append(el('p', 'v1-availability', availability()));
    });
  }
  function renderSummary() {
    preserveFocus(summaryBody, () => {
      summaryBody.replaceChildren();
      heading(summaryBody, 'CIDADE CONEXA · ACONTECIMENTOS', world && world.phase === 'closed' ? 'O que a comunidade construiu' : 'Investigações em andamento', 'Personagens e acontecimentos desta história são fictícios. As decisões da turma definem ações; as evidências definem os fatos.');
      if (!world) { summaryBody.append(el('p', '', 'Aguardando estado confirmado da cidade.')); return; }
      const participantCount = joined();
      summaryBody.append(el('p', 'v1-summary-status', phaseNames[world.phase] + ' · ' + participantCount + (participantCount === 1 ? ' participante na sessão' : ' participantes na sessão')));
      ConexaMissions.forEach((item, index) => {
        const section = el('section', 'v1-summary-mission');
        const completedCount = world.completed[index] || 0;
        append(section, el('h3', '', item.number + ' · ' + item.title), el('p', 'v1-summary-count', completedCount + (completedCount === 1 ? ' investigação concluída' : ' investigações concluídas')));
        if (index <= world.mission && (world.released & (1 << index))) section.append(el('p', 'v1-event', item.release));
        if (world.phase === 'closed' || index < world.mission) section.append(el('p', 'v1-facts-note', item.facts));
        if (Array.isArray(world.decisions) && Array.isArray(world.decisions[index])) {
          const results = el('ul', 'v1-decision-results');
          item.decisions.forEach((action, actionIndex) => {
            const row = el('li'); append(row, el('span', '', action.label), el('strong', '', String(world.decisions[index][actionIndex] || 0))); results.append(row);
          });
          section.append(results);
        } else section.append(el('p', 'v1-source', 'A distribuição das decisões será apresentada no encerramento.'));
        summaryBody.append(section);
      });
      summaryBody.append(el('p', 'v1-facts-note', 'Não há ranking de popularidade dos alunos. Os totais descrevem ações escolhidas para personagens fictícios.'));
    });
  }
  function renderTeacher() {
    if (!teacher) return;
    const detailsOpen = teacherPanel.querySelector('details')?.open || false;
    preserveFocus(teacherPanel, () => {
      teacherPanel.replaceChildren();
      heading(teacherPanel, 'JOGO COMPLETO · V1', 'Condução da experiência');
      teacherPanel.append(teacherFeedback);
      if (!world) { teacherPanel.append(el('p', '', 'Aguardando estado da cidade.')); return; }
      const current = ConexaMissions[world.mission];
      append(teacherPanel, el('p', 'v1-teacher-phase', phaseNames[world.phase] + ' · Missão ' + current.number), el('p', '', current.title));
      if (!world.teacher) {
        teacherPanel.append(el('p', 'v1-availability', 'Use a autenticação do professor abaixo para habilitar os controles.'));
        return;
      }
      const authorized = Boolean(world.teacher && ready());
      const controls = el('div', 'v1-teacher-controls');
      const add = (label, op, allowed, confirmationText) => {
        const control = button(label, () => confirmationText ? ask(op, confirmationText) : issue(op, 0));
        control.id = 'v1-control-' + op; control.disabled = !authorized || !allowed; controls.append(control);
      };
      add('Iniciar experiência', 'start', world.phase === 'lobby');
      add('Pausar', 'pause', world.phase === 'open');
      add('Retomar', 'resume', world.phase === 'paused');
      add('Liberar acontecimento', 'release', world.phase === 'open' && !(world.released & (1 << world.mission)));
      const incomplete = (world.completed[world.mission] || 0) < joined();
      add('Próxima missão', 'next', world.phase === 'open' && world.mission < 2 && Boolean(world.released & (1 << world.mission)), incomplete ? 'Há participantes que ainda não concluíram esta missão. Avançar libera a próxima investigação; as anteriores continuam disponíveis para recuperação. Continuar?' : 'Liberar a próxima missão para a turma? As pistas registradas permanecem disponíveis.');
      add('Encerrar experiência', 'finish', world.phase === 'open' || world.phase === 'paused', 'Encerrar interrompe novas ações e exibe os resultados coletivos. Revise a situação dos participantes antes de confirmar.');
      add('Reiniciar experiência', 'reset', true, 'Reiniciar apaga o progresso das três missões e as posições desta experiência para toda a turma. Os códigos de acesso são preservados. Esta ação não pode recuperar o progresso apagado. Confirmar?');
      teacherPanel.append(controls);
      const summaryList = el('ul', 'v1-teacher-progress');
      ConexaMissions.forEach((item, index) => summaryList.append(el('li', '', item.number + ' · ' + (world.completed[index] || 0) + '/' + joined() + ' concluíram')));
      teacherPanel.append(summaryList);
      const note = el('details', 'v1-guide'); note.open = detailsOpen;
      append(note, el('summary', '', 'Orientação pedagógica e participantes'), el('p', '', current.teacher));
      if (world.teacher && typeof world.teacher.progress === 'string') {
        const table = el('table', 'v1-participant-table');
        table.append(el('caption', '', 'Progresso por código numérico — sem respostas individuais'));
        const head = el('thead'), row = el('tr'); ['ID', 'Pistas 1/2/3', 'Concluídas'].forEach(text => row.append(el('th', '', text))); head.append(row); table.append(head);
        const body = el('tbody');
        for (let index = 0; index < 44; index++) {
          if (world.positions.slice(index * 2, index * 2 + 2) === '--') continue;
          const raw = world.teacher.progress.slice(index * 4, index * 4 + 4);
          if (!/^[0-9a-f]{4}$/i.test(raw)) continue;
          const values = Array.from(raw, character => parseInt(character, 16));
          const participant = el('tr');
          append(participant, el('th', '', String(index + 1).padStart(2, '0')), el('td', '', values.slice(0, 3).map(countBits).join(' / ')), el('td', '', [0, 1, 2].filter(bit => values[3] & (1 << bit)).map(bit => bit + 1).join(', ') || '—'));
          body.append(participant);
        }
        table.append(body); note.append(table);
      }
      teacherPanel.append(note);
      const collective = button('Ver acontecimentos e resultados', openSummary); collective.id = 'v1-teacher-summary'; teacherPanel.append(collective);
      teacherPanel.append(el('p', 'v1-facts-note', 'As decisões finais são modos de agir. A contagem não muda os fatos documentados no roteiro.'));
    });
  }
  function renderAll() { renderJournal(); renderConversation(); renderSummary(); renderTeacher(); }
  function openJournal() { renderJournal(); open(journal); }
  function openSummary() { renderSummary(); open(summary); }
  function interact(index) {
    if (!Number.isInteger(index) || index < 0 || index > 3) return false;
    if (projector) { openSummary(); return true; }
    activeClue = index; renderConversation(); open(conversation); signal('talk'); return true;
  }
  function update(next, nextStatus) {
    if (next === null) {
      const hadConfirmation = confirmation.open;
      cancelConfirmation();
      world = null; status = nextStatus || {}; pending = false;
      selectedMission = 0; activeClue = null; sessionKey = ''; lastKey = '';
      drafts.forEach(draft => { draft.links = ['', '', '', '']; draft.decision = ''; });
      report('');
      if (conversation.open) conversation.close();
      renderAll();
      if (hadConfirmation) report('O acesso ou a sessão mudou. A confirmação anterior foi cancelada. Solicite a ação novamente após entrar.');
      journalButton.dataset.mission = '0'; journalButton.dataset.completed = '0';
      return;
    }
    if (!next || next.v !== 1 || !Array.isArray(next.completed)) return;
    const newSession = String(next.boot) + ':' + String(next.epoch) + ':' + String(next.me ? next.me.id : 0);
    const previousDone = own() ? own().done : 0;
    const previousMask = mask();
    const previousMission = world && world.mission;
    const wasPending = pending;
    const previousConfirmation = confirmation.open ? confirmFingerprint : null;
    world = next; status = nextStatus || {}; pending = false;
    const confirmationChanged = previousConfirmation !== null && previousConfirmation !== controlFingerprint();
    if (confirmationChanged) cancelConfirmation();
    if (sessionKey !== newSession) {
      sessionKey = newSession; selectedMission = Math.min(2, Math.max(0, world.mission));
      activeClue = null;
      drafts.forEach(draft => { draft.links = ['', '', '', '']; draft.decision = ''; });
      report('');
      if (conversation.open) conversation.close();
    } else if (previousMission !== world.mission && !journal.open && !conversation.open) selectedMission = world.mission;
    // Other players walking changes world.rev frequently; it must not rebuild an open form.
    const presence = typeof next.positions === 'string' ? (next.positions.match(/.{2}/g) || []).map(position => position === '--' ? 0 : 1).join('') : '';
    const personal = next.me ? [next.me.id, next.me.clues, next.me.done, next.me.decisions] : null;
    const key = JSON.stringify([next.boot, next.epoch, next.phase, next.mission, next.released, presence, next.completed, next.decisions, personal, next.teacher ? next.teacher.progress : null, status.online, status.authenticated, status.busy, status.position || (next.me ? [next.me.x, next.me.y] : null)]);
    if (key !== lastKey || wasPending) { lastKey = key; renderAll(); }
    if (confirmationChanged) report('O estado da sessão mudou. A confirmação anterior foi cancelada. Revise a cidade e solicite a ação novamente.');
    if (own() && own().done !== previousDone) { report('Investigação concluída e confirmada pela cidade.'); signal('complete'); }
    else if (mask() !== previousMask) { report('Pista confirmada e registrada no diário.'); signal('clue'); }
    journalButton.dataset.mission = String(world.mission);
    journalButton.dataset.completed = String(own() ? own().done : 0);
  }
  renderAll();
  return {
    update, interact, openJournal, openSummary,
    showMessage: text => { pending = false; report(String(text)); renderAll(); },
    getMission: mission,
    getMissionIndex: () => selectedMission,
    getPointsOfInterest: () => mission().clues.map((clue, index) => ({ ...clue, index, collected: Boolean(mask() & (1 << index)), released: !clue.locked || released() })),
    hasOpenDialog: () => roots.some(node => node.tagName === 'DIALOG' && node.isConnected && node.open),
    destroy: () => { roots.forEach(node => { if (node.tagName === 'DIALOG' && node.open) node.close(); node.remove(); }); modalEvent(); }
  };
}
