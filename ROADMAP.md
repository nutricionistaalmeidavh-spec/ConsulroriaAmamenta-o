# Débora Lactação — Roadmap

## Estado desta migração
- Fonte copiada do AppDeploy: versão 1788188962225.
- Objetivo atual: criar uma cópia funcional no Cloudflare Workers sem desativar o AppDeploy.
- Nesta etapa, não incorporar melhorias funcionais ou visuais discutidas em outros chats do projeto.

## Próximas etapas após validar a cópia no Cloudflare
1. Consolidar o GitHub como fonte canônica.
2. Revisar autenticação e redirects multi-host (AppDeploy + Workers).
3. Reaplicar, em ordem controlada, as melhorias já discutidas para:
   - identidade visual e alinhamento com a landing page;
   - agenda e origem real dos atendimentos;
   - fluxo plano/individual e pagamento;
   - prontuário e histórico clínico;
   - remoção da opção de excluir paciente da interface;
   - limpeza do paciente de teste;
   - consistência de dashboard e métricas;
   - demais melhorias já definidas no projeto.
4. Validar mobile/PWA, service worker, autenticação, Supabase, biblioteca, curvas e agenda.
5. Só considerar desligar o AppDeploy após homologação completa da versão Cloudflare.

## Regra
Mudanças futuras devem ser aplicadas sobre a cópia validada no Cloudflare sem alterar retroativamente o snapshot desta migração.
