package com.gill.web;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** Gill Agent Web 服务入口（认证/空间/会话/WS 网关/文件/知识库/扩展中心）。 */
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
