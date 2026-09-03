# DESIGN — Débora Lactação

## Produto e público
Aplicação clínica mobile-first para consultora de amamentação. O objetivo principal das telas autenticadas é permitir registrar, recuperar e revisar um atendimento com segurança, sem perder o contexto mãe–bebê–consulta.

## Direção visual
A interface preserva a identidade atual: clínica acolhedora, profissional e discreta. A assinatura visual do prontuário é o **identificador persistido do atendimento** apresentado no cabeçalho e nos cards; ele comunica continuidade e segurança sem expor detalhes técnicos além do necessário.

## Tokens normativos
- `ink`: `#2F3833` — texto principal.
- `muted`: `#727A75` — texto secundário.
- `brand`: `#6B3F50` — ação clínica primária e foco de identidade.
- `brand-soft`: `#F5EDF0` — superfícies de apoio.
- `danger`: `#963F3B` — exclusões e ações irreversíveis.
- `surface`: `#FFFFFF` — superfícies de leitura e edição.
- `border`: `#DFE4E0` — divisores e campos.
- `focus`: `rgba(107,63,80,.32)` — foco visível.

Os tokens são materializados nas folhas `interaction-ui.css`, `clinical-note-feature.css` e `patient-fixes.css`. Novas superfícies clínicas devem reutilizar esses valores antes de criar novas variações.

## Tipografia
A aplicação atual usa a pilha do sistema para previsibilidade e legibilidade em iOS/Android/desktop. Hierarquia: 20–24 px para títulos de modal, 16–18 px para cards, 12–14 px para controles e corpo, 10–11 px para metadados clínicos. Não introduzir uma fonte remota sem uma decisão de produto separada.

## Layout
- Mobile: ações críticas em largura total; modal de prontuário ocupa a tela e respeita safe areas.
- Desktop: cards com leitura horizontal e prontuário em folha centralizada.
- Dados clínicos e controles destrutivos não disputam a mesma ênfase visual.
- O layout reserva espaço para status de salvamento e mensagens sem deslocar botões.

## Interações
- Ações destrutivas usam o modal canônico `DeboraUI.confirmTyped`; nunca `alert`, `confirm` ou `prompt` do navegador nas superfícies novas.
- Feedback transitório usa `DeboraUI.toast`.
- Foco visível, Escape, restauração de foco e navegação por Tab são obrigatórios em overlays.
- `prefers-reduced-motion` remove movimentos não essenciais.

## Prontuário
- O cabeçalho sempre mostra paciente, bebê(s), consulta e prefixo do `encounter_id`.
- Cards da ficha abrem um `encounter_id` específico.
- Edição e status deixam explícito quando o conteúdo foi sincronizado com o SQL.
- Histórico de revisões é uma camada de auditoria, não um segundo editor.
