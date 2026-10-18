import type { MetadataRoute } from "next";

/**
 * 私人部署默认全面禁止收录。
 *
 * 它挡不住直接访问（挡人靠 middleware 里的站点访问口令），但能让搜索引擎
 * 根本不去索引这个域名——「爬虫不知道你存在」和「爬虫进不来」是两件事，
 * 一起做才干净。这个声明是静态的、永远输出 Disallow: /，不需要任何配置。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
