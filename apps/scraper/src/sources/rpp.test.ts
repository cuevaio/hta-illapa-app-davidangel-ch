import { describe, expect, it } from "vitest";

import { parseRppArticle, parseRppFeed } from "./rpp";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:sy="http://purl.org/rss/1.0/modules/syndication/" xmlns:atom="http://www.w3.org/2005/Atom" version="2.0" xml:base="https://rpp.pe">
<channel>
    <title>RPP NOTICIAS</title>
    <link>https://rpp.pe</link>
    <atom:link href="https://rpp.pe/rss" rel="self" type="application/rss+xml"/>
    <lastBuildDate>Sun, 18 Oct 2026 00:49:59 -0500</lastBuildDate>
<item>
        <title><![CDATA[Tragedia en Pisco: cuatro fallecidos, entre ellos un menor de edad, deja accidente en antigua Panamericana Sur]]></title>
        <description><![CDATA[Un trágico accidente de tránsito en el kilómetro 230 de la vía dejó cuatro fallecidos y un herido que fue trasladado al Hospital San Juan de Dios de Pisco.]]></description>
        <pubDate>Sat, 17 Oct 2026 22:50:06 -0500</pubDate>
        <link>https://rpp.pe/peru/ica/accidente-en-la-antigua-panamericana-sur-de-pisco-deja-cuatro-muertos-y-un-herido-noticia-1713196</link>
        <guid isPermaLink="true">https://rpp.pe/peru/ica/accidente-en-la-antigua-panamericana-sur-de-pisco-deja-cuatro-muertos-y-un-herido-noticia-1713196</guid>
        <dc:type>Artículo</dc:type>
                <content:encoded>
              <![CDATA[
          Un accidente de tránsito registrado este sábado en el kilómetro 230 de la antigua Panamericana Sur, en la provincia de Pisco, región Ica, dejó un saldo de cuatro personas fallecidas.<br><br>            <div class="article__block article__block--recommend">
          <h4 class="article__block-title">Te recomendamos</h4>
                <a href="https://rpp.pe/lima/actualidad/callao-auto-queda-destrozado-tras-chocar-contra-un-tren-en-carmen-de-la-legua-noticia-1713188">
              ]]>
          </content:encoded>
</item>
<item>
         <title><![CDATA[Temblor en Perú, hoy 17 de octubre: magnitud y epicentro del sismo según IGP]]></title>
         <description><![CDATA[Actualización EN VIVO del último sismo en Perú hoy, sábado 17 de octubre según las últimas actualizaciones del Instituto Geofísico del Perú IGP]]></description>
         <pubDate>Fri, 16 Oct 2026 20:18:58 -0500</pubDate>
         <link>https://rpp.pe/lima/desastres-naturales/temblor-en-peru-hoy-16-de-octubre-magnitud-y-epicentro-del-sismo-segun-igp-live-3663</link>
         <guid isPermaLink="true">https://rpp.pe/lima/desastres-naturales/temblor-en-peru-hoy-16-de-octubre-magnitud-y-epicentro-del-sismo-segun-igp-live-3663</guid>
         <dc:type>Artículo</dc:type>
</item>
<item>
        <title><![CDATA[Sport Boys arremete contra arbitraje por el primer gol de Juan Pablo II: "¿Cómo quiere que Dulanto salte, con los brazos atrás?"]]></title>
        <description><![CDATA[Jostin Alarcón, capitán de Sport Boys, considera que el árbitro Jordi Espinoza "inclinó la cancha" a favor de Juan Pablo II.]]></description>
        <pubDate>Sat, 17 Oct 2026 18:35:04 -0500</pubDate>
        <link>https://rpp.pe/futbol/descentralizado/sport-boys-arremete-contra-arbitraje-por-el-primer-gol-de-juan-pablo-ii-como-quiere-que-dulanto-salte-con-los-brazos-atras-noticia-1713180</link>
        <guid isPermaLink="true">https://rpp.pe/futbol/descentralizado/sport-boys-arremete-contra-arbitraje-por-el-primer-gol-de-juan-pablo-ii-como-quiere-que-dulanto-salte-con-los-brazos-atras-noticia-1713180</guid>
        <dc:type>Artículo</dc:type>
</item>
</channel>
</rss>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xml:base="https://rpp.pe">
<channel>
  <title>RPP NOTICIAS</title>
  <link>https://rpp.pe</link>
  <lastBuildDate>Sun, 18 Oct 2026 00:53:49 -0500</lastBuildDate>
</channel>
</rss>`;

const ARTICLE_HEAD = `<head>
<meta name="description" content="Agentes de la unidad del Escuadr&oacute;n Verde de la Polic&iacute;a Nacional fueron intervenidos en Los Olivos tras ser denunciados por sustraer dinero de un local e intentar llevarse mercader&iacute;a." />
<meta name="author" content="RedacciónRPP" />
<meta property="article:section" content="Lima"/>
<script type="application/ld+json">
{
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "datePublished": "2026-10-17T18:07:10-05:00",
    "headline": "Seis agentes del Grupo Terna detenidos en Los Olivos por presunto robo de dinero a comerciante",
    "articleSection": "Lima"
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "RPP Noticias", "item": "https://rpp.pe" },
    { "@type": "ListItem", "position": 2, "name": "Lima", "item": "https://rpp.pe/lima" },
    { "@type": "ListItem", "position": 3, "name": " Policiales", "item": "https://rpp.pe/lima/policiales" },
    { "@type": "ListItem", "position": 4, "name": "Seis agentes del Grupo Terna detenidos en Los Olivos por presunto robo de dinero a comerciante", "item": "https://rpp.pe/lima/policiales/detienen-a-seis-policias-del-grupo-terna-por-presunto-robo-a-comerciante-en-los-olivos-noticia-1713182" }
  ]
}
</script>
</head>`;

describe("parseRppFeed", () => {
	it("reads id, url, title and publication time from each feed article and skips live blogs", () => {
		expect(parseRppFeed(FEED)).toEqual([
			{
				sourceId: "1713196",
				url: "https://rpp.pe/peru/ica/accidente-en-la-antigua-panamericana-sur-de-pisco-deja-cuatro-muertos-y-un-herido-noticia-1713196",
				title:
					"Tragedia en Pisco: cuatro fallecidos, entre ellos un menor de edad, deja accidente en antigua Panamericana Sur",
				publishedAt: new Date("2026-10-18T03:50:06.000Z"),
			},
			{
				sourceId: "1713180",
				url: "https://rpp.pe/futbol/descentralizado/sport-boys-arremete-contra-arbitraje-por-el-primer-gol-de-juan-pablo-ii-como-quiere-que-dulanto-salte-con-los-brazos-atras-noticia-1713180",
				title:
					'Sport Boys arremete contra arbitraje por el primer gol de Juan Pablo II: "¿Cómo quiere que Dulanto salte, con los brazos atrás?"',
				publishedAt: new Date("2026-10-17T23:35:04.000Z"),
			},
		]);
	});

	it("throws on a feed without articles instead of returning an empty list", () => {
		expect(() => parseRppFeed(EMPTY_FEED)).toThrow(/no articles/);
	});
});

describe("parseRppArticle", () => {
	it("reads the decoded excerpt, the breadcrumb subsection and the author", () => {
		expect(parseRppArticle(ARTICLE_HEAD)).toEqual({
			excerpt:
				"Agentes de la unidad del Escuadrón Verde de la Policía Nacional fueron intervenidos en Los Olivos tras ser denunciados por sustraer dinero de un local e intentar llevarse mercadería.",
			section: "Policiales",
			author: "RedacciónRPP",
		});
	});

	it("returns nulls without a description, an author or a valid breadcrumb", () => {
		expect(
			parseRppArticle(
				'<head><script type="application/ld+json">{"@type": "BreadcrumbList", "itemListElement": [</script></head>',
			),
		).toEqual({ excerpt: null, section: null, author: null });
	});
});
