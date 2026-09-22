# Conta de demonstração isolada — Débora Lactação

Data: 2026-09-22
Status: design aprovado em conversa; especificação pronta para revisão antes da implementação

## Objetivo

Criar um acesso de demonstração para apresentações comerciais do sistema Débora Lactação, com dados totalmente fictícios, aparência de uso real e acesso às funcionalidades Pro, sem misturar dados com pacientes reais e sem depender de checkout, serviço pago ou infraestrutura externa adicional.

## Restrições

- O core continua em Cloudflare/D1/R2 e no código já existente do projeto.
- Não usar AppDeploy.
- Não versionar senha, token ou segredo.
- Não copiar nenhum dado real para o ambiente demo.
- O reset da demonstração deve ser incapaz de apagar registros de outros usuários.
- Toda entidade clínica demo deve possuir `owner_id` igual ao usuário demo.
- A conta demo deve usar a autenticação local atual (`auth_users` + `auth_credentials`).
- A conta demo deve poder ser recriada de forma idempotente.

## Identidade do demo

E-mail: `demonstracao@deboralactacao.com`.

O usuário terá um UUID estável e reservado para a demonstração. O UUID e o e-mail podem constar no código como identificadores não secretos; a senha nunca deve ser persistida no repositório.

`user_metadata_json` e/ou `app_metadata_json` devem incluir um marcador explícito, por exemplo `{"demo":true,"purpose":"commercial-presentation"}`, para permitir validação defensiva antes de qualquer reset.

A senha será recebida por variável de ambiente/argumento de execução e transformada com o mesmo PBKDF2-SHA256 usado pelo runtime. O script deve recusar senha vazia ou fraca.

## Isolamento de dados

O runtime clínico atual armazena dados migrados/canônicos em `supabase_records`, identificados por `table_name`, `record_key` e `owner_id`.

Todos os registros criados pelo seed devem usar o UUID reservado do demo como `owner_id`. Nenhuma rotina de seed/reset pode usar `DELETE` sem filtro de proprietário.

O reset deve seguir uma estratégia de allowlist:

1. Validar que o usuário encontrado pelo UUID reservado possui o e-mail demo esperado.
2. Validar que os metadados do usuário contêm `demo: true`.
3. Remover somente `supabase_records WHERE owner_id = DEMO_USER_ID`.
4. Revogar/remover somente sessões de refresh daquele `user_id`.
5. Atualizar/recriar somente as credenciais daquele `user_id` quando solicitado.
6. Nunca executar limpeza global por `table_name`.
7. Recriar os dados fictícios em seguida.

Se qualquer uma das validações falhar, o script deve abortar sem modificar o banco.

## Plano Pro da demonstração

A conta demo deve exibir comportamento Pro sem passar pelo checkout.

O seed criará registros comerciais pertencentes ao mesmo `owner_id`:

- `saas_accounts`: conta ativa;
- `professional_profiles`: perfil profissional fictício;
- `subscriptions`: assinatura interna/demo ativa, sem `external_customer_id` ou cobrança real;
- `entitlements`: todas as permissões exigidas pelo plano Pro vigente no projeto.

A implementação deve reutilizar os mesmos `feature_key` e a mesma semântica de entitlements usados pelo produto. Não deve criar uma regra paralela de UI do tipo `if demo then unlock`; o demo deve percorrer o mesmo caminho normal de autorização de uma conta Pro.

## Dados fictícios

O cenário inicial deve ser coerente entre agenda, pacientes, bebês e prontuários. Nomes, telefones, documentos, e-mails e observações serão sintéticos e não corresponderão a pessoas reais.

### Perfil profissional

- Nome: `Mariana Alves` (fictício)
- Negócio: `Espaço Materno - Demonstração`
- Telefone fictício reservado para demonstração, sem WhatsApp real
- Configurações preenchidas para evitar telas vazias

### Pacientes e bebês

Criar 6 mães e 6 ou 7 bebês, com variedade suficiente para demonstrar os principais estados do sistema.

Pares:

1. Ana Martins / Helena
2. Juliana Costa / Theo
3. Camila Ribeiro / Laura
4. Fernanda Lima / Miguel
5. Beatriz Souza / Alice
6. Renata Gomes / Lucas e Sofia (gêmeos)

Os registros devem usar datas relativas à data de geração, para que a agenda e os dashboards continuem parecendo atuais ao longo do tempo.

### Agenda

Criar compromissos em diferentes estados:

- consultas concluídas nos últimos dias;
- uma consulta para o dia atual;
- consultas futuras;
- ao menos um retorno/follow-up.

Datas devem ser calculadas em runtime pelo seed, nunca congeladas em 2026.

### Prontuários e atendimentos

Criar pelo menos 3 `clinical_encounters` completos e vinculados às mães/bebês correspondentes, incluindo:

- motivo principal fictício;
- avaliação da mamada;
- conduta/orientações;
- evolução;
- observações clínicas sintéticas.

Nenhum conteúdo deve sugerir que se trata de diagnóstico ou prontuário de pessoa real. Dados sensíveis fictícios devem ser claramente sintéticos.

### Crescimento

Criar séries de pesos/medidas em múltiplas datas para pelo menos 3 bebês, suficientes para gerar visualização de evolução/curvas sem tela vazia.

### Follow-up

Criar acompanhamentos concluídos e pendentes, relacionados aos atendimentos seedados.

### Documentos

Criar metadados/registros de documentos fictícios que a UI consiga listar. Não é necessário gerar binários R2 no primeiro seed se a UI aceitar documento sem arquivo; se o fluxo exigir arquivo real, usar somente arquivos sintéticos e explicitamente demo.

### Financeiro

Criar movimentações fictícias apenas se o módulo estiver atualmente exposto no plano Pro. Usar valores plausíveis e descrições como `Consulta domiciliar - demonstração`, sem dados fiscais reais.

## Scripts

Adicionar:

- `scripts/seed-demo-account.mjs`
- `scripts/reset-demo-account.mjs`

Adicionar comandos no `package.json`:

- `npm run demo:seed`
- `npm run demo:reset`

Os scripts devem operar sobre o D1 configurado pelo projeto via Wrangler/Cloudflare CLI existente, sem SDK pago e sem dependência nova obrigatória.

O `seed` deve ser idempotente: executar duas vezes produz o mesmo conjunto lógico de dados, atualizando datas relativas sem duplicar pacientes.

O `reset` será essencialmente `validação defensiva -> limpeza por owner_id -> seed`.

## Segurança da senha

A senha não deve ser colocada em:

- código-fonte;
- package.json;
- documentação pública;
- commit;
- logs do CI.

O script aceitará a senha por variável de ambiente `DEMO_PASSWORD`. O hash deve seguir o contrato atual de `auth_credentials` (PBKDF2-SHA256, salt aleatório, número de iterações compatível com o runtime).

## Testes

Criar testes automatizados para no mínimo:

1. seed usa somente o UUID demo como `owner_id`;
2. reset contém filtro obrigatório de `owner_id`;
3. reset aborta se e-mail não corresponder ao demo;
4. reset aborta se `demo:true` não estiver presente nos metadados;
5. nenhum `DELETE FROM supabase_records` sem `WHERE owner_id = ?` é aceito;
6. dois seeds consecutivos não duplicam o cenário;
7. todos os relacionamentos mãe/bebê/consulta/prontuário apontam para IDs existentes;
8. os dados comerciais criados pertencem ao mesmo owner;
9. credencial gerada autentica segundo o mesmo algoritmo do runtime;
10. nenhum segredo ou senha padrão é incluído nos fixtures.

Testes existentes de auth/deploy safety devem continuar passando.

## Critérios de aceite

- Login demo funciona pela tela de login normal.
- Após o login, o sistema mostra dados exclusivamente fictícios.
- Pacientes, bebês, agenda, atendimentos, crescimento, follow-up e recursos Pro relevantes têm conteúdo suficiente para apresentação.
- A conta demo não enxerga dados de Débora nem de qualquer outro usuário.
- Um usuário real nunca enxerga os registros demo.
- `npm run demo:reset` restaura o cenário sem tocar em qualquer outro `owner_id`.
- Não existe senha demo no GitHub.
- Nenhuma dependência paga é adicionada.

## Fora de escopo

- Checkout real para a conta demo.
- Dados copiados de pacientes reais.
- Integração com WhatsApp real.
- E-mail transacional específico para demo.
- Ambiente Cloudflare separado apenas para demonstração.

## Estratégia de entrega

A implementação deve ser feita com TDD, começando pelos invariantes de segurança do reset e pelo contrato do fixture. Depois entram geração de credencial, seed de identidade/comercial, seed clínico e por fim validação do login/fluxos existentes.
