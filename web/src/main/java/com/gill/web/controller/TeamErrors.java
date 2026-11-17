package com.gill.web.controller;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import java.util.*;

/** Error envelope limited to the new team API; never reports a domain failure as login expiry. */
@RestControllerAdvice(assignableTypes={TeamController.class,TeamWorkerController.class})
public class TeamErrors {
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<?> invalid(IllegalArgumentException ex) {
        String message=Objects.toString(ex.getMessage(),"INVALID_INPUT");
        String code=message.contains(":")?message.substring(0,message.indexOf(':')):"INVALID_INPUT";
        int status=switch(code){case "SCOPE_FORBIDDEN"->403;case "NOT_FOUND"->404;case "VERSION_CONFLICT","IDEMPOTENCY_CONFLICT","LEASE_LOST","BUSY"->409;default->400;};
        return ResponseEntity.status(status).body(Map.of("error",Map.of("code",code,"message",message)));
    }
}
