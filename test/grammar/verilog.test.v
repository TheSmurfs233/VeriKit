// SYNTAX TEST "source.verilog" "Verilog 着色基础"

    // module foo is disabled
//  ^^ comment.line.double-slash.verilog

    module counter #(
//  ^^^^^^ keyword.other.module.verilog
//         ^^^^^^^ entity.name.type.module.verilog

    parameter WIDTH = 8;
//  ^^^^^^^^^ storage.modifier.verilog
//                    ^ constant.numeric.verilog

    input  clk,
//  ^^^^^ storage.type.port.verilog
    output reg q
//  ^^^^^^ storage.type.port.verilog
//         ^^^ storage.type.verilog

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

    always @(posedge clk or negedge rst_n) begin
//  ^^^^^^ keyword.control.verilog
//           ^^^^^^^ keyword.other.edge.verilog
//                       ^^ keyword.other.edge.verilog
//                                          ^^^^ keyword.other.block.verilog

    end
//  ^^^ keyword.other.block.verilog
