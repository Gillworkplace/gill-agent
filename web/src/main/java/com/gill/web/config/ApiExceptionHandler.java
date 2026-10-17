package com.gill.web.config;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 统一错误信封（01 §11.13.2）。 */
@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(com.gill.web.controller.SpaceController.ApiException.class)
    public ResponseEntity<?> handle(com.gill.web.controller.SpaceController.ApiException e) {
        return ResponseEntity.status(e.status)
                .body(java.util.Map.of("error", java.util.Map.of("code", e.code, "message", e.getMessage())));
    }
}
