# Визуальный стиль «Маркетинговый плов» и промпты для нейросетей

Обновлено 25.10.2026. Референсы лежат рядом:

- `brand/avatar.jpg` — аватарка канала: пиала с пловом, слово «МАРКЕТИНГ» выложено из риса.
- `brand/cover-example-gashtak.jpg` — обложка к посту про гаштак (11.10). Картинку взяли из интернета и с помощью нейросети стилизовали под тему и цвета канала: стена из купюр 100 000 сумов, руки в жёлтых строительных перчатках кладут раствор.

При генерации прикладывай обе картинки к запросу как референс стиля (image reference / style reference), если нейросеть это умеет.

## Из чего складывается стиль

| Элемент | Аватарка | Обложка-пример | Правило |
|---|---|---|---|
| Фон | Тёплый кремовый, около #F6E9D6 | Светлый тёплый серо-бежевый, около #E3DED8 | Однотонный светлый тёплый фон, много пустого места |
| Главные цвета | Жёлтый и золотистый рис, морковно-оранжевый, синяя пиала | Жёлто-охристые перчатки, персиково-сиреневые купюры | Жёлтый, охра, бежевый как основа. Один контрастный акцент: синий узбекский орнамент или оранжевый |
| Подача | Аккуратная иллюстрация, вид сбоку, по центру | Коллаж: цветной объект на ч/б фото, вырезанные элементы, плоские тени | Один главный объект, без лишних деталей |
| Локальность | Плов, пиала в синем узбекском орнаменте (риштанская керамика) | Узбекские купюры 100 000 сумов | В каждой картинке есть узнаваемая деталь Узбекистана |
| Идея | Маркетинг = плов | Общий бюджет = стена, которую строят вместе | Картинка — визуальная метафора идеи поста, а не просто иллюстрация к теме |

Чего избегать (из обсуждений команды 11.10 и 20.10):
- «бедно» выглядящих картинок и случайных стоковых фото;
- слишком перегруженных или нелепых сцен («ну это через чур»);
- долларов и монет там, где речь об Узбекистане: лучше сумы;
- чужих логотипов и людей, похожих на реальных;
- текста на картинке, кроме случаев, когда он и есть идея (как на аватарке). Нейросети часто искажают кириллицу, такие надписи нужно проверять.

Формат: квадрат 1:1 (1080×1080 или больше) или вертикаль 4:5 для поста в Telegram.

## Шаблоны промптов

Промпты на английском: большинство генераторов (Midjourney, DALL·E / ChatGPT, Gemini, Flux, Ideogram) понимают его лучше. В квадратных скобках подставь своё.

### 1. Коллаж-метафора (как обложка про гаштак) — основной вариант для постов

```
Editorial collage illustration, square 1:1. [Main metaphor: e.g. "hands in yellow work gloves laying a brick wall made of Uzbek 100,000 som banknotes"].
Mixed media: one key object in full warm color, supporting elements as black-and-white photo cutouts, simple flat shadows.
Plain warm light beige background (#E3DED8), lots of negative space at the top.
Palette: mustard yellow, ochre, warm beige, soft peach, one accent of [cobalt blue / carrot orange].
Clean, minimal, modern magazine style. No text, no logos, no real people's faces.
```

### 2. Иллюстрация «кухня = маркетинг» (как аватарка)

```
Detailed appetizing illustration, centered, square 1:1. [Object: e.g. "a traditional Uzbek blue-and-white Rishtan ceramic bowl of plov"] that represents [idea of the post, e.g. "a marketing budget split into portions"].
Warm cream background (#F6E9D6), soft light, slight steam, no clutter.
Palette: golden rice yellow, carrot orange, deep cobalt blue ornament, warm brown.
Friendly, cozy, premium food-illustration style. No extra text.
```

### 3. Стилизация готовой картинки из интернета (как сделали обложку про гаштак)

Прикрепи найденную картинку и референсы из `brand/`, затем:

```
Restyle the attached image to match the attached brand references: keep the composition and main idea, but
- make the background a plain warm light beige,
- turn secondary elements black-and-white and keep the key object in warm mustard-yellow/ochre color,
- replace [dollars / generic objects] with [Uzbek som banknotes / Uzbek details: plov, tandoor, samsa, Rishtan blue ceramics],
- remove any text, watermarks and logos.
Minimal editorial collage look, square 1:1.
```

### 4. Предметная сцена из жизни Узбекистана (для рубрики «Маркетинг из жизни»)

```
Minimal editorial photo-illustration, square 1:1. [Scene: e.g. "a queue of cars near a small roadside samsa tandoor without a sign"].
Shot slightly from above, one clear focal point, warm natural light.
Warm beige and mustard-yellow color grading, muted background, one accent color.
Authentic Uzbekistan details, not touristy. No text, no logos, no recognizable faces.
```

### Как придумать метафору

1. Возьми главную мысль поста одной фразой («общий бюджет работает дольше»).
2. Найди бытовой предмет, который её показывает (стена, которую строят вместе).
3. Добавь узбекскую деталь (купюры в сумах).
4. Проверь: понятна ли идея за 1 секунду без текста?

Промпты к конкретному посту можно попросить в этом проекте: дай текст поста, и Claude предложит 2–3 метафоры и готовые промпты по шаблонам выше.
