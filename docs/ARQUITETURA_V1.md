# CONEXA GAME V1 — arquitetura e contratos

A V1 integra a cidade R1 e a câmera mobile P2.1-C ao firmware existente. Não há backend externo. O roteador fornece a LAN dedicada; a ESP32 conecta como estação e serve as três páginas. Canvas 2D, JavaScript nativo, fontes do sistema e áudio sintetizado no navegador dispensam internet e bibliotecas de execução.

## Autoridade e estado

`game_core.c/.h` mantém integralmente a autenticação por identidade da camada HTTP, entrada, enquete P0, idempotência e resultados originais. `world_core.c/.h` acrescenta posições, três missões e condução. As duas presenças são confirmadas atomicamente na entrada, inclusive nos limites dos contadores. A tarefa HTTP serializa as mutações. Os núcleos não alocam heap.

O mundo contém 44 slots fixos por ID, uma posição hexadecimal x/y por participante, máscaras de quatro pistas por missão, três bits de conclusão, decisões e recibo da última operação. Não usa nomes, fotografias ou ranking de alunos. NPCs e narrativas são ficção pedagógica. Participantes podem compartilhar um tile; colisões são com o cenário, para evitar bloqueios deliberados entre alunos.

O estado reside na RAM. Perda de Wi-Fi, fechamento do navegador e recarga permitem retornar com o mesmo código à mesma execução. O código precisa ser digitado novamente após recarga: credenciais permanecem apenas na memória da aba. Reiniciar/desligar a placa gera outro `boot` e limpa progresso. O controle de reinício do professor incrementa `epoch`, preserva entradas e limpa posições/progresso. Nenhum desses reinícios restaura progresso antigo.

## HTTP aditivo

As rotas e corpos P0 `/api/state`, `/api/join`, `/api/vote`, `/api/control`, `/api/health` permanecem. A enquete anterior está no menu **Enquete de leitura** e usa controles separados do jogo completo.

| Rota nova | Uso |
|---|---|
| `GET /api/session` | Envelope `{p0,world}` para uma consulta serializada por cliente. |
| `GET /api/world` | Snapshot V1, com campos privados conforme papel autenticado. |
| `POST /api/world/action` | Corpo exato `{boot,epoch,seq,op,arg}`; identidade somente pelo Bearer existente. |
| `GET /api/avatars` | Manifesto público sem credenciais ou dados pessoais. |
| `GET /avatars.webp` | Atlas local opcional; 404 quando não há cartoons. |

Operações: `move`, `inspect`, `resolve` para aluno; `start`, `pause`, `resume`, `release`, `next`, `finish`, `reset` para professor. Visitantes apenas leem. O corpo HTTP mantém o limite de 384 bytes, parser plano estrito e prazo total de recepção. Campos extras, números não canônicos, identidade no corpo e operações de outro papel são rejeitados.

`seq` é estritamente o próximo contador do próprio papel/ID (até 2.147.483.647). Repetição exata de sequência, operação e argumento confirma o recibo sem reaplicar. Sequência igual com conteúdo diferente é conflito. `boot` e `epoch` bloqueiam pedidos antigos. O reset mantém recibo específico da época anterior para reconhecer resposta perdida. Depois de erro ou perda de resposta, o navegador consulta a sessão antes de repetir o mesmo corpo. Duas abas com o mesmo código competem pelo mesmo contador; a aba atrasada reconcilia e descarta a intenção conflitante. Recomenda-se uma aba por aluno.

O snapshot público contém posições e contagens de conclusão. Decisões agregadas só aparecem ao público após encerramento. O aluno recebe apenas suas próprias escolhas/pistas. O professor recebe máscaras de progresso por ID e totais, sem as escolhas individuais. Não existe transmissão de chave ou código em URL, armazenamento do navegador, asset ou projeção.

## Movimento, frequência e câmera

O Canvas anima localmente a 250 ms/tile e limita a quatro passos ainda não confirmados. A ESP32 valida grid 14×14, colisões, distância BFS de no máximo seis tiles, intervalo mínimo de 800 ms e crédito de velocidade de um tile/250 ms. O envio do navegador é espaçado em pelo menos 1.050 ms. Não há envio por frame. Caminhos que retornam à posição confirmada não geram movimento nulo.

Existe uma fila HTTP por aba, compartilhada com a enquete P0. Movimentação usa ciclos próximos de 1–1,3 s; ocioso consulta em 2,2–2,8 s. Falhas usam backoff até aproximadamente 15,5 s. Retomar comunicação exige leitura antes de escrita. O avatar local distingue a posição animada da confirmada; outros participantes são desenhados a partir do snapshot confirmado. NPCs não entram na contagem de presenças. Presença significa entrada na execução, não comprovação de conexão naquele instante; a saúde P0 informa alunos ativos na janela recente.

A câmera e o HUD preservam o resgate mobile: cena em tela inteira, toque no chão, arraste para olhar, retorno ao avatar, direcional e zoom recolhidos. Teclado usa setas; redução de movimento mantém a velocidade e validação, retirando interpolação. Diálogos suspendem o controle local. Professor e projeção possuem modos próprios.

## Missões e evidências

Cada missão exige quatro interações com proximidade Manhattan de até um tile: mural (10,4), escola/Lia (5,5), praça/Caio (6,10) e arquivo/Nara (12,6). A quarta fonte depende da liberação do professor. Os fatos e associações corretas são fixos no núcleo; a votação nunca redefine o roteiro.

Para concluir, o aluno retorna ao mural, associa quatro afirmações às respectivas fontes e escolhe uma ação. A associação é validada antes da consequência, e a decisão fica separada dos fatos. Conclusões são imutáveis na execução; repetição exata continua idempotente. O professor pode avançar após liberar o acontecimento; missões anteriores permanecem recuperáveis até encerrar. Confirmações abertas são invalidadas quando a sessão ou o recibo docente muda.

Os sinais na cidade e o diário refletem somente conclusões confirmadas. Áudio é opcional, iniciado por gesto do usuário, sem arquivos externos. Os 44 avatares procedurais mantêm identidade por ID e fallback para cartoons ausentes/inválidos; consulte o manual de avatares.

## Limites e validação pendente

O harness Node é exclusivo de testes, escuta somente em loopback e usa códigos sintéticos. As regras e JSON são produzidos pelos mesmos arquivos C de produção. Ele não reproduz o escalonamento, sockets, heap, rádio ou energia da ESP32. Os testes de 44 identidades provam lógica e renderização; capacidade para 44 dispositivos exige ensaio físico.

HTTP, Bearer e LAN sem TLS preservam o modelo P0. A atividade deve usar uma rede controlada e distribuição privada dos códigos. Não há mecanismo de prova de identidade civil nem proteção contra compartilhamento voluntário do código. O jogo é uma atividade pedagógica, não um sistema de prova com prevenção de consulta ao código fonte.

Orçamentos: HTML 256 KiB, gzip 64 KiB, snapshot mundo 3 KiB, corpo POST 384 B, atlas WebP 128 KiB e 6 MiB decodificados no navegador. São limites de projeto; memória livre dinâmica, latência e estabilidade reais constam do roteiro físico, não de declarações baseadas em simulação.
