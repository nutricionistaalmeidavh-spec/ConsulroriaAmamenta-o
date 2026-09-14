# Débora Lactação — Roadmap

## Estado atual
- GitHub é a fonte canônica do projeto.
- Frontend e Worker são publicados no Cloudflare.
- Dados clínicos foram copiados e validados no D1 `debora-lactacao-clinical`.
- Arquivos clínicos usam o R2 `debora-lactacao-clinical`.
- O cutover final preserva o Supabase somente como rollback e ponte temporária para sessões/senhas antigas.
- O licenciamento comercial permanece centralizado na autoridade Artisys e no painel administrativo.

## Cutover Cloudflare
1. Validar a migração D1/R2 já concluída.
2. Aplicar o schema de autenticação Cloudflare.
3. Materializar o runtime clínico canônico.
4. Rodar os gates locais de regressão.
5. Sincronizar o segredo da autoridade de licenças entre Central Artisys e Débora.
6. Publicar o Worker com bindings D1/R2.
7. Validar health check, contagens e licenciamento.
8. Manter a origem anterior intacta até a homologação funcional final.

## Homologação funcional
- login e persistência de sessão;
- pacientes e bebês;
- agenda;
- atendimento, rascunho e prontuário;
- documentos, fotos, vídeos e PDFs;
- financeiro e pacotes;
- limites Freemium/Pro;
- liberação, renovação e revogação pelo painel administrativo;
- PWA/service worker sem cache de rotas privadas.

## Regra
Nenhuma migração ou cutover apaga automaticamente a origem anterior. Remoção definitiva só deve ocorrer após homologação completa da versão Cloudflare.
