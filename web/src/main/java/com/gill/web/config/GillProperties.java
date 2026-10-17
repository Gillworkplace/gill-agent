package com.gill.web.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** 集中配置项（application.yml gill.*）。 */
@ConfigurationProperties(prefix = "gill")
public record GillProperties(String jwtSecret, int jwtTtlHours,
                             String initAdminUsername, String initAdminPassword) {
}
