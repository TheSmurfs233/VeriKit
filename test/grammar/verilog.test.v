// SYNTAX TEST "source.verilog" "Verilog 着色基础"

    // module foo is disabled
//  ^^ comment.line.double-slash.verilog

    module counter #(
//  ^^^^^^ keyword.other.module.verilog
//         ^^^^^^^ entity.name.type.module.verilog

    parameter WIDTH = 8;
//  ^^^^^^^^^ storage.type.verilog
//                    ^ constant.numeric.verilog

    assign y = 8'hFF;
//  ^^^^^^ keyword.control.verilog
//             ^^^^^ constant.numeric.verilog

    $display("hi");
//  ^^^^^^^^ support.function.system.verilog
//           ^^^^ string.quoted.double.verilog

    `timescale 1ns / 1ps
//  ^^^^^^^^^^ keyword.control.preprocessor.verilog

    q <= ~q;
//    ^^ keyword.operator.verilog

    endmodule
//  ^^^^^^^^^ keyword.other.module.verilog
