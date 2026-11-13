# ClickDown

Gerenciador de projetos e tarefas em português, com React, TypeScript, Vite, Express e SQLite. Os registros de trabalho, arquivos anexados, responsáveis, notificações e atividades são persistidos no banco do aplicativo. Não há funcionalidade de importação/exportação de projetos ou tarefas, nem migração de arquivos pelo navegador.

## Executar

Requer Node.js 24 ou superior.

```sh
npm install
npm run dev
```

Abra http://127.0.0.1:5173. A API roda na porta 3001; o banco `data/clickdown.sqlite` é criado/atualizado automaticamente. Para servir o build e a API juntos:

```sh
npm run build
npm start
```

Abra http://127.0.0.1:3001. `npm run preview` serve somente arquivos estáticos. Para verificar a aplicação: `npm test` (API com banco temporário, migração, reinícios e testes da interface).

## Projetos, tarefas e responsáveis

Crie uma conta pessoal ou entre em um dos quatro perfis demo. Projetos são compartilhados pela equipe e possuem os papéis proprietário, administrador, editor e leitor. Os controles são aplicados na API, inclusive nos anexos e registros de atividade.

- Proprietários e administradores podem usar **Editar projeto** para alterar nome, descrição e responsável pelo quadro. O nome é atualizado no cabeçalho, menu e demais referências. A edição da interface usa revisão para detectar mudanças simultâneas.
- Tarefas **e subtarefas aceitam N responsáveis**, sem um limite fixo além dos membros do próprio projeto. Use os checkboxes e a busca de pessoas nos detalhes. A API recebe `assignees: [id, ...]` e valida todos os vínculos.
- Quem já era responsável antes desta atualização é mantido automaticamente. O campo `assignee` é preservado como referência de compatibilidade ao primeiro ID; a lista `assignees` é a fonte completa. Alterar apenas status/prazo não apaga os demais responsáveis.
- Cartões exibem os avatares e a quantidade de responsáveis; a lista exibe todos os nomes. Minhas tarefas, filtros, calendário e lembretes consideram qualquer pessoa atribuída, tanto na tarefa quanto nas subtarefas.
- Remover alguém da equipe retira seu acesso e remove somente essa pessoa das atribuições, preservando os outros responsáveis.

O quadro possui arrastar/reordenar, lista, calendário, busca, prioridades, etiquetas, prazos e temas claro/escuro. A preferência de aparência fica no navegador; os dados de trabalho ficam no SQLite.

## Registro de atividades e notificações

O menu **Registro de atividades** reúne o log compartilhado dos projetos acessíveis à pessoa conectada. Mostra **o que mudou, quem fez, data/hora e valores anteriores/novos**. Há filtro por projeto, busca por pessoa/atividade/conteúdo e paginação de 50 eventos. O workspace consulta atualizações a cada 10 segundos enquanto a aba está visível e ao recuperar foco; o registro e a caixa aberta acompanham novos eventos.

São registrados:

- Criação e edição do projeto, incluindo nome, descrição e responsável pelo quadro.
- Inclusão/remoção de membros, mudanças de papel e criação/cancelamento/aceite de convites.
- Configuração, ordem, cores e migração das colunas.
- Criação e alterações dos detalhes, responsáveis, prazos, prioridades, etapas e posição das tarefas.
- Comentários, menções, checklist, anexos e alterações em subtarefas.
- Movimento para lixeira, restauração e exclusão definitiva.

Os eventos são criados pelo servidor, com a identidade da sessão, **na mesma transação** da mudança. Requisições rejeitadas e salvamentos sem alterações não criam eventos. O log não possui edição ou exclusão pela API. A exclusão definitiva de uma tarefa preserva seus eventos no registro do projeto, com o título e a autoria registrados. O link para abrir a tarefa fica indisponível quando ela foi removida ou está na lixeira.

O histórico de tarefas já armazenado é incorporado ao registro global uma única vez, preservando autor e horário, sem gerar alertas retroativos em massa. Alterações antigas de projeto que nunca foram registradas não podem ser reconstruídas. O registro não substitui um sistema de auditoria externo resistente a alterações feitas diretamente pelo administrador do banco.

O sino contém notificações pessoais de menções, novas atribuições e **mudanças nos projetos/tarefas da equipe**, com autor, horário e detalhes. Os demais membros do projeto recebem as atividades; o autor consulta suas próprias ações no registro. É possível marcar como lida/não lida ou ler todas. Leitura é pessoal e persistida no banco. Pessoas sem acesso ao projeto não podem consultar seus eventos ou notificações.

Reordenar um cartão dentro da mesma coluna permanece registrado no histórico, mas não gera notificação. Mover para outra coluna ou alterar outros campos continua notificando normalmente.

Lembretes cobrem tarefas/subtarefas atribuídas a qualquer um dos responsáveis com prazo para hoje/amanhã ou já vencido, sem duplicar ao atualizar a tela. Conclusão, troca de prazo, retirada do responsável, perda de acesso ou envio para lixeira ocultam lembretes que deixaram de ser pertinentes. São gerados ao consultar o workspace/notificações, no fuso `APP_TIMEZONE`; não há envio de e-mail ou push com o aplicativo fechado.

## Colunas, subtarefas e colaboração

**Colunas** permite a proprietários/administradores definir de 2 a 12 etapas com nome, cor, ordem e categoria. Categorias: A fazer, Em andamento, Em revisão e Concluído. Mantenha pelo menos uma etapa de trabalho e uma de conclusão. Ao remover uma etapa, escolha o destino: tarefas, subtarefas e itens na lixeira são migrados atomicamente. Etapas removidas não reaparecem ao reiniciar.

Visão geral e Minhas tarefas agrupam projetos pelas categorias, respeitando as etapas reais de cada projeto. A categoria determina indicadores e lembretes. Configurações concorrentes são sinalizadas como conflito.

Em uma tarefa salva, **Nova subtarefa** cria uma atividade com descrição, N responsáveis, prazo e status próprios. Até 100 subtarefas ativas, em um nível. Títulos: até 160 caracteres; descrições: até 4.000. Elas têm revisão independente, progresso no cartão e datas no calendário. Selecioná-las abre a tarefa principal. A conclusão das subtarefas e da tarefa principal é independente; comentários e anexos ficam na tarefa principal.

Comentários suportam seleção de membros com `@`; setas/Enter escolhem a sugestão, Escape fecha e Ctrl/Command+Enter envia quando não há sugestões. Até 4.000 caracteres, 20 menções e 1.000 comentários por tarefa. Textos não executam HTML. O checklist permite 100 itens de até 240 caracteres. Rascunhos são protegidos ao fechar o diálogo, mas não sobrevivem ao recarregamento da página.

## Equipe e acesso

| Papel         | Consultar | Editar tarefas/subtarefas/anexos | Configurar projeto/colunas | Gerenciar editores/leitores | Gerenciar administradores | Excluir definitivamente |
| ------------- | --------- | -------------------------------- | -------------------------- | --------------------------- | ------------------------- | ----------------------- |
| Proprietário  | Sim       | Sim                              | Sim                        | Sim                         | Sim                       | Sim                     |
| Administrador | Sim       | Sim                              | Sim                        | Sim                         | Não                       | Sim                     |
| Editor        | Sim       | Sim                              | Não                        | Não                         | Não                       | Não                     |
| Leitor        | Sim       | Não                              | Não                        | Não                         | Não                       | Não                     |

Use **Equipe** para adicionar contas existentes pelo e-mail. Para novos usuários, copie e compartilhe o link privado de convite; a pessoa precisa criar conta com o e-mail convidado e aceitar o link. Não há envio automático de e-mail, verificação de e-mail, recuperação de senha ou transferência de propriedade nesta versão.

## Anexos e lixeira

Anexos: PNG, JPEG, GIF, WebP, MP4, WebM, MP3, WAV e PDF. Até 20 MB por arquivo, 10 por tarefa e 500 MB por projeto. O servidor identifica o formato pelo conteúdo. Downloads e prévias são autenticados; baixar um anexo continua disponível e não representa exportar os dados do projeto.

Mover para a **Lixeira** preserva comentários, checklist, anexos e subtarefas. Editores podem restaurar; só proprietários/administradores excluem definitivamente, após confirmação. Subtarefas também possuem lixeira. Se o cartão principal estiver na lixeira, seu conteúdo fica dentro dele. Nada é apagado automaticamente por tempo. A exclusão definitiva remove o conteúdo em cascata, mas preserva os eventos do projeto.

## Demonstração

Na tela de entrada, **Experimente antes de começar** oferece Ana Costa (proprietária), Bruno Lima (administrador), Clara Souza (editora) e Diego Alves (leitor), sem senha pública. O primeiro acesso cria um ambiente fictício isolado por navegador com um projeto preenchido, etapas, comentários, checklist, subtarefas, notificações e lixeira. **Explorar como** alterna papéis nesse mesmo ambiente. Demos anteriores recebem exemplos adicionais uma vez, sem recriar o banco.

O cookie do ambiente demo é HttpOnly, dura 30 dias e é separado da sessão. Perfis demo não podem participar de projetos pessoais nem convidar contas reais; contas reais não podem adicioná-los aos seus projetos. Para usar dados próprios, saia e crie uma conta pessoal. `DEMO_ENABLED=false` ou `NODE_ENV=production` desativa a demo e suas sessões existentes. Não há usuário administrador global com credencial conhecida.

## Banco e implantação

Usuários, hashes de senha, sessões, projetos, colunas, atribuições, tarefas, subtarefas, mídias, comentários, checklist, lixeira, log e notificações residem no SQLite. A pasta `data/` é ignorada pelo Git. Senhas usam scrypt com salt aleatório; tokens de sessão ficam como hash e cookies são HttpOnly/SameSite=Strict. Há validação de origem e limitação de autenticação.

Não existe rota `/api/import`, botão de exportação, restauração JSON ou gravação de tarefas em localStorage. As tabelas antigas de migração são preservadas para não apagar registros existentes, mas não oferecem uma função de importação. Proteja o disco do servidor e mantenha backups operacionais do banco; isso é uma responsabilidade de infraestrutura, sem fluxo na interface do produto.

Para acesso entre dispositivos, sirva a mesma instância Node.js por HTTPS, com disco persistente. Publicar somente o frontend não é suficiente. O aplicativo não exige assinatura; custos de hospedagem externa dependem do provedor. Use uma instância da API por banco SQLite, sem réplicas independentes.

| Variável        | Padrão                                | Uso                                       |
| --------------- | ------------------------------------- | ----------------------------------------- |
| `PORT`          | `3001`                                | Porta da API/build                        |
| `HOST`          | `127.0.0.1`                           | Use `0.0.0.0` para servir na rede         |
| `DATA_DIR`      | `./data`                              | Diretório persistente                     |
| `APP_ORIGINS`   | localhost/127.0.0.1, portas 5173/3001 | Origens autorizadas separadas por vírgula |
| `COOKIE_SECURE` | `false`                               | `true` quando servido por HTTPS           |
| `APP_TIMEZONE`  | `America/Fortaleza`                   | Fuso IANA dos lembretes                   |
| `DEMO_ENABLED`  | `true` em desenvolvimento             | `false` desativa demonstrações            |
| `NODE_ENV`      | não definido                          | `production` desativa demo                |

Em produção, configure HTTPS, a origem real e disco persistente; não exponha `data/` por arquivos estáticos. Para backup completo, pare o serviço e copie a pasta de dados inteira, guardando-a de forma protegida.

## Arquivamento de tarefas

Abra um card e clique em **Arquivar**. A tarefa sai do quadro, listas, calendário e lembretes de prazo, mas permanece no banco com responsáveis, comentários, checklist, anexos, subtarefas e histórico. **Arquivados**, no menu lateral, permite buscar, filtrar por projeto e consultar os detalhes em modo de leitura.

Proprietários, administradores e editores podem arquivar e restaurar; leitores podem consultar os arquivos dos projetos aos quais pertencem. A restauração devolve a tarefa à coluna de origem com seus dados preservados. Alterações simultâneas são verificadas pela revisão da tarefa. Arquivamento e restauração registram autor e horário no histórico do projeto. Para excluir uma tarefa arquivada, restaure-a e use a lixeira.

## GitHub Pages

O workflow `.github/workflows/pages.yml` executa os testes e publica a interface a cada push na branch `main`. A versão Pages usa a base `/click-down/`. O Pages hospeda somente arquivos estáticos: a API Express e o SQLite precisam de um servidor Node com disco persistente. Sem essa API, a página informa a indisponibilidade; não oferece login nem persistência simulados. Para executar o aplicativo completo, siga as instruções locais acima ou publique o servidor com `npm start` após `npm run build`. O banco em `data/` e arquivos `.env` não são versionados nem publicados.
